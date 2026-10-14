"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection } from "wagmi";
import type { Business } from "@/lib/market/types";
import type { QuoteAsset } from "@/lib/market/onchain";
import { useIsSignedIn, useSession, useWalletSignIn } from "@/hooks/useSession";
import { useQuoteAssets } from "@/hooks/useQuoteAssets";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { LaunchPanel } from "@/components/create/LaunchPanel";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/contracts/constants";
import { OWNER_ESCROW_ADDRESS, OWNER_FEE_BPS } from "@/lib/config/public";
import { checkImageMeta } from "@/lib/metadata/validate";
import {
  ValidationError, normalizeSymbol, normalizeTokenName, parseAmount, formatAmount, formatCompact, shortenAddress, suggestTicker, marketPath,
} from "@/lib/validation/normalize";
import { bpsOf } from "@/lib/market/math";

const STEP_LABELS = ["Token", "Market", "Review", "Tokenize"];

function defaultDescription(b: Business): string {
  const where = [b.address, b.city, b.country].filter(Boolean).join(", ");
  return `${b.name}${b.category ? ` — ${b.category.toLowerCase()}` : ""}${where ? ` in ${where}` : ""}. Community token on mapin. Not affiliated with the business unless marked as claimed.`.slice(0, 1000);
}

export function TokenizeWizard({ business }: { business: Business }) {
  const { address, isConnected, chainId } = useConnection();
  const session = useSession();
  const signedIn = useIsSignedIn();
  const { signIn, pending: signing, error: signError } = useWalletSignIn();
  const quotes = useQuoteAssets();

  const [step, setStep] = useState(0);
  // Pre-filled from the map; the launcher can change them before launching.
  const [tokenName, setTokenName] = useState(business.name.slice(0, 32).trim());
  const [symbol, setSymbol] = useState(suggestTicker(business.name));
  const [description, setDescription] = useState(defaultDescription(business));
  const [logo, setLogo] = useState<File | null>(null);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [quoteAddr, setQuoteAddr] = useState<string>("");
  const [initialBuy, setInitialBuy] = useState("0");

  const logoUrl = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo]);
  useEffect(() => () => {
    if (logoUrl) URL.revokeObjectURL(logoUrl);
  }, [logoUrl]);

  const cfg = session.data?.configured;
  const onChain = chainId === CHAIN_ID;
  const gateOk = Boolean(isConnected && onChain && signedIn && cfg?.metadata && cfg?.escrow);

  const quote: QuoteAsset | undefined = useMemo(() => {
    const list = quotes.data?.assets ?? [];
    return list.find((a) => a.address === quoteAddr) ?? list[0];
  }, [quotes.data, quoteAddr]);

  const tokenErrors = useMemo(() => {
    const e: string[] = [];
    try { normalizeTokenName(tokenName); } catch (err) { e.push((err as Error).message); }
    try { normalizeSymbol(symbol); } catch (err) { e.push((err as Error).message); }
    if (new TextEncoder().encode(twitter).length > 256 || new TextEncoder().encode(telegram).length > 256) e.push("Social links must be 256 bytes or fewer");
    if (!description.trim()) e.push("Description is required");
    if (description.length > 1000) e.push("Description must be 1000 characters or fewer");
    if (!logo) e.push("A logo image is required (a photo of the storefront works)");
    else {
      const m = checkImageMeta(logo.type, logo.size);
      if (m) e.push(m);
    }
    return e;
  }, [tokenName, symbol, description, logo, twitter, telegram]);

  const launchTerms = quotes.data?.launch ?? null;
  const protocolMax = launchTerms ? Number(launchTerms.maxCreatorTaxBps) : null;

  const market = useMemo(() => {
    const errors: string[] = [];
    let initial = 0n;
    if (!quote) errors.push(`Launch terms could not be loaded from ${CHAIN_NAME}`);
    else {
      try {
        initial = parseAmount(initialBuy || "0", quote.decimals);
      } catch (err) {
        errors.push(err instanceof ValidationError ? `Initial buy: ${err.message}` : "Invalid initial buy");
      }
    }
    if (launchTerms && !launchTerms.enabled) errors.push("Launching is currently paused by the launch protocol");
    if (protocolMax !== null && OWNER_FEE_BPS > protocolMax) errors.push(`The owner share (${OWNER_FEE_BPS / 100}%) is above the protocol cap (${protocolMax / 100}%)`);
    return { errors, initial };
  }, [quote, initialBuy, launchTerms, protocolMax]);

  if (business.market) {
    return (
      <div className="container section">
        <Notice tone="info" title="Already on the map">
          {business.name} is already tokenized as ${business.market.symbol}.{" "}
          <Link href={marketPath(business.slug)}>Open its market →</Link>
        </Notice>
      </div>
    );
  }

  const gate = (
    <div className="card stack">
      <div className="panel-title">Before you start</div>
      {cfg && !cfg.sessions ? <Notice tone="warn" title="Sign-in not configured">The server needs DATABASE_URL and SESSION_SECRET. See the README.</Notice> : null}
      {cfg && !cfg.metadata ? <Notice tone="warn" title="Logo upload not configured">Set METADATA_UPLOAD_URL on the server.</Notice> : null}
      {cfg && !cfg.escrow ? <Notice tone="warn" title="Owner escrow not configured">Set NEXT_PUBLIC_OWNER_ESCROW_ADDRESS on the server. See README → Owner escrow.</Notice> : null}
      <ol className="progress-list">
        <li data-state={isConnected ? "done" : "active"}>
          {isConnected ? "✓" : "1."} Connect wallet {isConnected && address ? <span className="muted">({shortenAddress(address)})</span> : null}
        </li>
        <li data-state={isConnected && onChain ? "done" : isConnected ? "active" : undefined}>{isConnected && onChain ? "✓" : "2."} {CHAIN_NAME}</li>
        <li data-state={signedIn ? "done" : isConnected && onChain ? "active" : undefined}>{signedIn ? "✓" : "3."} Sign in with wallet (free, no transaction)</li>
      </ol>
      {!isConnected ? <ConnectButton /> : null}
      {isConnected && !onChain ? <Notice tone="warn">Use the banner at the top to switch to {CHAIN_NAME}.</Notice> : null}
      {isConnected && onChain && !signedIn && cfg?.sessions ? (
        <button type="button" className="btn btn-primary" disabled={signing} onClick={() => signIn()}>
          {signing ? <span className="spinner" aria-hidden /> : null} Sign in with wallet
        </button>
      ) : null}
      {signError ? <Notice tone="error">{signError}</Notice> : null}
    </div>
  );

  const next = () => setStep((s) => Math.min(3, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const fee = quotes.data?.fee;
  const initialFee = fee && quote ? bpsOf(market.initial, BigInt(fee.buyBps) + BigInt(OWNER_FEE_BPS)) : null;
  const launchFeeWei = launchTerms ? BigInt(launchTerms.launchFee) : null;
  const gradThreshold =
    quote && !quote.isNative
      ? quote.graduationThreshold ? BigInt(quote.graduationThreshold) : null
      : launchTerms ? BigInt(launchTerms.graduationThreshold) : null;
  const where = [business.address, business.city, business.country].filter(Boolean).join(", ");

  return (
    <div className="container section">
      <div className="place-head">
        <div className="place-pin" aria-hidden>📍</div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Tokenize {business.name}</h1>
          <div className="small muted">{[business.category, where].filter(Boolean).join(" · ")}</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <span className="badge">{business.claimed ? "✓ Claimed by owner" : "Unofficial · not affiliated"}</span>
            <span className="badge">{business.source === "osm" ? "OpenStreetMap place" : "Added by the community"}</span>
          </div>
        </div>
      </div>

      {!gateOk ? (
        gate
      ) : (
        <>
          <ol className="steps">
            {STEP_LABELS.map((l, i) => (
              <li key={l} data-state={i < step ? "done" : i === step ? "current" : undefined}>{i + 1}. {l}</li>
            ))}
          </ol>

          {step === 0 ? (
            <div className="card stack">
              <div className="panel-title">Step 1 — Token</div>
              <p className="small muted" style={{ margin: 0 }}>
                Name and ticker are filled in from the map. Change them if you like — the token stays tied to this place either way.
              </p>
              <div className="grid grid-2">
                <div className="field">
                  <label className="label" htmlFor="tname">Token name</label>
                  <input id="tname" className="input" maxLength={32} value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="tsym">Ticker</label>
                  <div className="input-group">
                    <span className="addon">$</span>
                    <input id="tsym" className="input" maxLength={10} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
                  </div>
                  <span className="hint">1–10 letters or digits</span>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="desc">Description</label>
                <textarea id="desc" className="textarea" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
                <span className="hint">{description.length}/1000</span>
              </div>
              <div className="field">
                <span className="label">Logo</span>
                <div className="logo-drop">
                  <TokenLogo src={logoUrl} symbol={symbol || "?"} large />
                  <div className="stack" style={{ gap: 4 }}>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} aria-label="Logo image" />
                    <span className="hint">PNG, JPEG, WebP or GIF · max 2 MB · square works best</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-2">
                <div className="field">
                  <label className="label" htmlFor="tw">X / Twitter (optional)</label>
                  <input id="tw" className="input" maxLength={100} value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/…" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="tg">Telegram (optional)</label>
                  <input id="tg" className="input" maxLength={100} value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="https://t.me/…" />
                </div>
              </div>
              {tokenErrors.length ? <Notice tone="warn">{tokenErrors.join(" · ")}</Notice> : null}
              <div className="row between">
                <Link className="btn" href={`/?place=${business.id}`}>← Map</Link>
                <button type="button" className="btn btn-primary" disabled={tokenErrors.length > 0} onClick={next}>Continue →</button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="card stack">
              <div className="panel-title">Step 2 — Market</div>
              <div className="field">
                <span className="label">Pair</span>
                {quotes.isLoading ? <Spinner label={`Reading launch terms from ${CHAIN_NAME}…`} /> : null}
                {quotes.isError ? <Notice tone="error">{(quotes.error as Error).message}</Notice> : null}
                {quotes.data ? (
                  <div className="pair-grid" role="radiogroup" aria-label="Pair">
                    {quotes.data.assets.map((a) => (
                      <button
                        key={a.address}
                        type="button"
                        role="radio"
                        aria-checked={quote?.address === a.address}
                        className="pair-btn"
                        onClick={() => setQuoteAddr(a.address)}
                        title={a.name ?? a.symbol}
                      >
                        {a.symbol}
                      </button>
                    ))}
                  </div>
                ) : null}
                <span className="hint">
                  {quote && !quote.isNative
                    ? `Buyers pay in ${quote.symbol}; liquidity graduates into a ${symbol || "token"}/${quote.symbol} pool. The launch fee is paid in ETH.`
                    : "ETH, or any Robinhood stock token / stablecoin the launch contract accepts right now."}
                </span>
              </div>
              <div className="field">
                <label className="label" htmlFor="ib">Initial buy (optional)</label>
                <div className="input-group">
                  <input id="ib" className="input" inputMode="decimal" value={initialBuy} onChange={(e) => setInitialBuy(e.target.value)} />
                  <span className="addon">{quote?.symbol ?? "—"}</span>
                </div>
                <span className="hint">{quote && !quote.isNative ? "Bought right after the launch (approve + buy, two extra wallet confirmations)." : "Buy in the same transaction as the launch. 0 = launch only."}</span>
              </div>
              <div className="owner-share">
                <strong>{OWNER_FEE_BPS / 100}% of every trade is held for the owner</strong>
                <span className="small">
                  It goes to the mapin owner escrow ({shortenAddress(OWNER_ESCROW_ADDRESS)}) and is paid out when the real owner claims {business.name}. This is fixed for every business.
                </span>
              </div>
              {market.errors.length ? <Notice tone="warn">{market.errors.join(" · ")}</Notice> : null}
              <div className="row between">
                <button type="button" className="btn" onClick={back}>← Back</button>
                <button type="button" className="btn btn-primary" disabled={market.errors.length > 0 || !quote} onClick={next}>Review →</button>
              </div>
            </div>
          ) : null}

          {step === 2 && quote ? (
            <div className="card stack">
              <div className="panel-title">Step 3 — Review</div>
              <div className="row">
                <TokenLogo src={logoUrl} symbol={symbol} large />
                <div>
                  <h3 style={{ margin: 0 }}>{tokenName}</h3>
                  <div className="mono muted">${symbol}</div>
                </div>
              </div>
              <dl className="review">
                <dt>Business</dt><dd>{business.name}{where ? ` — ${where}` : ""}</dd>
                <dt>Map location</dt><dd>{business.lat.toFixed(5)}, {business.lng.toFixed(5)}</dd>
                <dt>Your wallet</dt><dd>{address}</dd>
                <dt>Pair</dt><dd>{symbol}/{quote.symbol}{quote.name && !quote.isNative ? ` (${quote.name})` : ""}</dd>
                <dt>Initial buy</dt><dd>{market.initial > 0n ? `${formatAmount(market.initial, quote.decimals, 8)} ${quote.symbol}` : "None"}</dd>
                <dt>Owner share</dt><dd>{OWNER_FEE_BPS / 100}% of every buy and sell → owner escrow until claimed</dd>
                <dt>Estimated fees</dt>
                <dd>
                  {launchFeeWei !== null ? `Launch fee ${formatAmount(launchFeeWei, 18, 8)} ETH` : "Launch fee unavailable"}
                  {" · "}
                  {fee
                    ? `Curve fee ${Number(fee.buyBps) / 100}%${initialFee && initialFee > 0n ? ` (≈ ${formatAmount(initialFee, quote.decimals, 8)} ${quote.symbol} on your initial buy incl. owner share)` : ""}`
                    : "Trading fee unavailable"}
                  {" · "}Gas is shown in your wallet.
                </dd>
                <dt>Supply</dt><dd>{launchTerms ? `${formatCompact(BigInt(launchTerms.supply), 18)} ${symbol} (fixed)` : "—"}</dd>
                <dt>Graduation</dt><dd>{gradThreshold !== null ? `When ${formatAmount(gradThreshold, quote.decimals, 4)} ${quote.symbol} is raised, liquidity moves to a locked Uniswap v4 pool.` : "When the curve fills, liquidity moves to a locked Uniswap v4 pool."}</dd>
              </dl>
              <Notice tone="info">
                One place = one token. This is a community token, not an official one from {business.name}. The launch is simulated on {CHAIN_NAME} first; if the simulation fails, nothing is sent.
              </Notice>
              <div className="row between">
                <button type="button" className="btn" onClick={back}>← Back</button>
                <button type="button" className="btn btn-primary" onClick={next}>Continue →</button>
              </div>
            </div>
          ) : null}

          {step === 3 && quote && logo ? (
            <LaunchPanel
              input={{
                businessId: business.id,
                businessName: business.name,
                description: description.trim(),
                tokenName,
                symbol,
                logo,
                twitter,
                telegram,
                quote: { address: quote.address, symbol: quote.symbol, decimals: quote.decimals, isNative: quote.isNative },
                initialBuy: market.initial,
              }}
              onBack={back}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
