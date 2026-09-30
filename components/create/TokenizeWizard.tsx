"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection } from "wagmi";
import type { Place } from "@/lib/market/types";
import type { QuoteAsset } from "@/lib/market/onchain";
import { useIsSignedIn, useSession, useWalletSignIn } from "@/hooks/useSession";
import { useQuoteAssets } from "@/hooks/useQuoteAssets";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { LaunchPanel } from "@/components/create/LaunchPanel";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/contracts/constants";
import { checkImageMeta } from "@/lib/metadata/validate";
import { DAY, MAX_TAX_BPS, type TaxConfig } from "@/lib/launch/params";
import {
  ValidationError, normalizeSymbol, normalizeTokenName, parseAmount, formatAmount, shortenAddress, suggestTicker, marketPath,
} from "@/lib/validation/normalize";
import { bpsOf } from "@/lib/market/math";

const STEP_LABELS = ["Token", "Market", "Review", "Launch"];

const FEE_DURATIONS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
  { days: 1825, label: "5 years" },
  { days: 36500, label: "Permanent (100 years)" },
];
const ANTI_FARMER = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

function pctToBps(v: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) return null;
  const [w, f = ""] = v.trim().split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

function defaultDescription(p: Place): string {
  const kind = p.placeType ? p.placeType.toLowerCase() : "place";
  return `The community token of ${p.name}${p.region ? `, ${p.region}` : ""} — a ${kind} on the mapin world map.`.slice(0, 1000);
}

export function TokenizeWizard({ place }: { place: Place }) {
  const { address, isConnected, chainId } = useConnection();
  const session = useSession();
  const signedIn = useIsSignedIn();
  const { signIn, pending: signing, error: signError } = useWalletSignIn();
  const quotes = useQuoteAssets();

  const [step, setStep] = useState(0);
  // Filled in from the map; the creator can change them before launching.
  const [tokenName, setTokenName] = useState(place.name.slice(0, 32).trim());
  const [symbol, setSymbol] = useState(suggestTicker(place.name));
  const [description, setDescription] = useState(defaultDescription(place));
  const [logo, setLogo] = useState<File | null>(null);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");

  const [quoteAddr, setQuoteAddr] = useState<string>("");
  const [initialBuy, setInitialBuy] = useState("0");
  const [feeOn, setFeeOn] = useState(true);
  const [buyFee, setBuyFee] = useState("1");
  const [sellFee, setSellFee] = useState("1");
  const [feeDays, setFeeDays] = useState(36500);
  const [antiHours, setAntiHours] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [splitCreator, setSplitCreator] = useState("100");
  const [splitBurn, setSplitBurn] = useState("0");
  const [splitLp, setSplitLp] = useState("0");

  const logoUrl = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo]);
  useEffect(() => () => {
    if (logoUrl) URL.revokeObjectURL(logoUrl);
  }, [logoUrl]);

  const cfg = session.data?.configured;
  const onChain = chainId === CHAIN_ID;
  const gateOk = Boolean(isConnected && onChain && signedIn && cfg?.metadata);

  const quote: QuoteAsset | undefined = useMemo(() => {
    const list = quotes.data?.assets ?? [];
    return list.find((a) => a.address === quoteAddr) ?? list[0];
  }, [quotes.data, quoteAddr]);

  const tokenErrors = useMemo(() => {
    const e: string[] = [];
    try { normalizeTokenName(tokenName); } catch (err) { e.push((err as Error).message); }
    try { normalizeSymbol(symbol); } catch (err) { e.push((err as Error).message); }
    if (!description.trim()) e.push("Description is required");
    if (description.length > 1000) e.push("Description must be 1000 characters or fewer");
    if (!logo) e.push("A logo image is required");
    else {
      const m = checkImageMeta(logo.type, logo.size);
      if (m) e.push(m);
    }
    return e;
  }, [tokenName, symbol, description, logo]);

  const market = useMemo(() => {
    const errors: string[] = [];
    let initial = 0n;
    if (!quote) errors.push(`Pair assets could not be loaded from ${CHAIN_NAME}`);
    else {
      try {
        initial = parseAmount(initialBuy || "0", quote.decimals);
      } catch (err) {
        errors.push(err instanceof ValidationError ? `Initial buy: ${err.message}` : "Invalid initial buy");
      }
    }
    let tax: TaxConfig | null = null;
    if (feeOn) {
      const b = pctToBps(buyFee);
      const s = pctToBps(sellFee);
      const sc = pctToBps(splitCreator);
      const sb = pctToBps(splitBurn);
      const sl = pctToBps(splitLp);
      if (b === null || s === null) errors.push("Creator fees must be percentages with up to 2 decimals");
      else if (b > MAX_TAX_BPS || s > MAX_TAX_BPS) errors.push(`Creator fees are capped at ${MAX_TAX_BPS / 100}%`);
      else if (b === 0 && s === 0) errors.push("Set a buy or sell fee above 0%, or turn creator fees off");
      if (sc === null || sb === null || sl === null) errors.push("Fee split must be percentages");
      else if (sc + sb + sl !== 10_000) errors.push("Fee split must add up to 100%");
      if (!errors.length) {
        tax = {
          buyBps: b!, sellBps: s!, durationSeconds: BigInt(feeDays) * DAY, antiFarmerSeconds: BigInt(antiHours) * 3600n,
          marketBps: sc!, deflationBps: sb!, lpBps: sl!,
        };
      }
    }
    return { errors, initial, tax };
  }, [quote, initialBuy, feeOn, buyFee, sellFee, splitCreator, splitBurn, splitLp, feeDays, antiHours]);

  if (place.market) {
    return (
      <div className="container section">
        <Notice tone="info" title="Already on the map">
          {place.name} is already tokenized as ${place.market.symbol}. <Link href={marketPath(place.slug)}>Open its market →</Link>
        </Notice>
      </div>
    );
  }

  const gate = (
    <div className="card stack">
      <div className="panel-title">Before you start</div>
      {cfg && !cfg.sessions ? <Notice tone="warn" title="Sign-in not configured">The server needs DATABASE_URL and SESSION_SECRET. See the docs.</Notice> : null}
      {cfg && !cfg.metadata ? <Notice tone="warn" title="Logo upload not configured">Set METADATA_UPLOAD_URL on the server.</Notice> : null}
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
  const initialFee = fee && quote ? bpsOf(market.initial, BigInt(fee.buyBps)) : null;

  return (
    <div className="container section">
      <div className="place-head">
        <div className="place-pin" aria-hidden>📍</div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Tokenize {place.name}</h1>
          <div className="small muted">{[place.placeType, place.region].filter(Boolean).join(" · ")}</div>
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
                The name and ticker come from the map. Change them if you like — the token stays tied to {place.name} either way.
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
                    <span className="hint">PNG, JPEG, WebP or GIF · max 2 MB · square works best (a flag, skyline or landmark)</span>
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
                <Link className="btn" href={`/app?place=${place.id}`}>← Map</Link>
                <button type="button" className="btn btn-primary" disabled={tokenErrors.length > 0} onClick={next}>Continue →</button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="card stack">
              <div className="panel-title">Step 2 — Market</div>
              <div className="grid grid-2">
                <div className="field">
                  <span className="label">Pair</span>
                  {quotes.isLoading ? <Spinner label={`Reading supported pairs from ${CHAIN_NAME}…`} /> : null}
                  {quotes.isError ? <Notice tone="error">{(quotes.error as Error).message}</Notice> : null}
                  {quotes.data ? (
                    <div className="pair-grid" role="radiogroup" aria-label="Pair">
                      {quotes.data.assets.map((a) => (
                        <button key={a.address} type="button" role="radio" aria-checked={quote?.address === a.address} className="pair-btn" onClick={() => setQuoteAddr(a.address)}>
                          {a.symbol}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <span className="hint">Only pair assets currently enabled on-chain are listed.</span>
                </div>
                <div className="field">
                  <label className="label" htmlFor="ib">Initial buy (optional)</label>
                  <div className="input-group">
                    <input id="ib" className="input" inputMode="decimal" value={initialBuy} onChange={(e) => setInitialBuy(e.target.value)} />
                    <span className="addon">{quote?.symbol ?? "—"}</span>
                  </div>
                  <span className="hint">Buy your own token in the launch transaction. 0 = launch only.</span>
                </div>
              </div>

              <div className="field">
                <span className="label">Creator fees</span>
                <div className="seg" role="group" aria-label="Creator fees">
                  <button type="button" aria-pressed={feeOn} onClick={() => setFeeOn(true)}>Earn creator fees</button>
                  <button type="button" aria-pressed={!feeOn} onClick={() => setFeeOn(false)}>No fees</button>
                </div>
                <span className="hint">Creator fees take a percentage of every buy and sell and pay it to your wallet ({address ? shortenAddress(address) : "the creator"}).</span>
              </div>
              {feeOn ? (
                <div className="grid grid-2">
                  <div className="field">
                    <label className="label" htmlFor="bf">Fee on buys</label>
                    <div className="input-group"><input id="bf" className="input" value={buyFee} onChange={(e) => setBuyFee(e.target.value)} /><span className="addon">%</span></div>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="sf">Fee on sells</label>
                    <div className="input-group"><input id="sf" className="input" value={sellFee} onChange={(e) => setSellFee(e.target.value)} /><span className="addon">%</span></div>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="fd">Fee duration</label>
                    <select id="fd" className="select" value={feeDays} onChange={(e) => setFeeDays(Number(e.target.value))}>
                      {FEE_DURATIONS.map((d) => <option key={d.days} value={d.days}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="af">Anti-farming window</label>
                    <select id="af" className="select" value={antiHours} onChange={(e) => setAntiHours(Number(e.target.value))}>
                      {ANTI_FARMER.map((d) => <option key={d.hours} value={d.hours}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setAdvanced((v) => !v)}>
                      {advanced ? "▾" : "▸"} Fee split (advanced)
                    </button>
                    {advanced ? (
                      <div className="grid grid-3">
                        <div className="input-group"><input aria-label="Creator share" className="input" value={splitCreator} onChange={(e) => setSplitCreator(e.target.value)} /><span className="addon">% creator</span></div>
                        <div className="input-group"><input aria-label="Burn share" className="input" value={splitBurn} onChange={(e) => setSplitBurn(e.target.value)} /><span className="addon">% burn</span></div>
                        <div className="input-group"><input aria-label="Liquidity share" className="input" value={splitLp} onChange={(e) => setSplitLp(e.target.value)} /><span className="addon">% liquidity</span></div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
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
                <dt>Place</dt><dd>{place.name}{place.region ? ` — ${place.region}` : ""}</dd>
                <dt>Type</dt><dd>{place.placeType ?? "Area"}</dd>
                <dt>Creator wallet</dt><dd>{address}</dd>
                <dt>Pair</dt><dd>{symbol}/{quote.symbol}</dd>
                <dt>Initial buy</dt><dd>{market.initial > 0n ? `${formatAmount(market.initial, quote.decimals, 8)} ${quote.symbol}` : "None"}</dd>
                <dt>Creator fees</dt>
                <dd>
                  {market.tax
                    ? `Buy ${market.tax.buyBps / 100}% · Sell ${market.tax.sellBps / 100}% · ${market.tax.marketBps / 100}% to creator / ${market.tax.deflationBps / 100}% burn / ${market.tax.lpBps / 100}% liquidity · ${FEE_DURATIONS.find((d) => d.days === feeDays)?.label}`
                    : "None"}
                </dd>
                <dt>Estimated fees</dt>
                <dd>
                  {fee
                    ? `Protocol trading fee ${Number(fee.buyBps) / 100}% on buys${initialFee && initialFee > 0n ? ` (≈ ${formatAmount(initialFee, quote.decimals, 8)} ${quote.symbol} on your initial buy)` : ""}`
                    : "Protocol fee unavailable"}
                  {" · "}Gas is shown in your wallet.
                  {market.tax && !quote.isNative ? " · 0.000000001 BNB is attached (required for fee tokens with a token pair)." : ""}
                </dd>
                <dt>Graduation</dt><dd>At 80% of supply sold, liquidity migrates to a PancakeSwap v2 pool.</dd>
              </dl>
              <Notice tone="info">
                One place = one token. The launch is simulated on {CHAIN_NAME} before your wallet opens; if the simulation fails, nothing is sent.
              </Notice>
              <div className="row between">
                <button type="button" className="btn" onClick={back}>← Back</button>
                <button type="button" className="btn btn-primary" onClick={next}>Continue to launch →</button>
              </div>
            </div>
          ) : null}

          {step === 3 && quote && logo ? (
            <LaunchPanel
              input={{
                placeId: place.id,
                placeName: place.name,
                description: description.trim(),
                tokenName,
                symbol,
                logo,
                twitter,
                telegram,
                quote: { address: quote.address, symbol: quote.symbol, decimals: quote.decimals, isNative: quote.isNative },
                initialBuy: market.initial,
                tax: market.tax,
              }}
              onBack={back}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
