"use client";

import { useState, type FormEvent } from "react";
import { useBalance, useReadContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatEther, parseEther, stringToHex, type Abi, type Address } from "viem";
import places from "@/lib/countries/places.json";
import { CHAIN_ID } from "@/lib/contracts/constants";
import { MAPIN_LAUNCHPAD, launchTokenAbi, mapinAbi } from "@/lib/contracts/mapin-abi";
import { explorerToken, explorerTx } from "@/lib/config/public";
import { formatAmount, parseAmount } from "@/lib/validation/normalize";
import { Notice } from "@/components/ui/Notice";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { useMapinTx, type MapinToken } from "@/components/countries/useMapin";

export interface Place { id: string; name: string; flag: string; currency: string; currencyName: string; currencySymbol: string; perUsd: number }
export const PLACES = places as Place[];
export const PLACE = new Map(PLACES.map((p) => [p.id, p]));
export const CURRENCY_COUNT = new Set(PLACES.map((p) => p.currency)).size;
export const SUPPLY = 1_000_000_000;
const SLIPPAGE_BPS = 300n; // 3 %: a country buy crosses two curves

const b32 = (s: string) => stringToHex(s, { size: 32 });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const minOut = (v: bigint) => (v * (10_000n - SLIPPAGE_BPS)) / 10_000n;

/** Parse a user amount: accepts "0.05" and "0,05". */
function parseUser(raw: string): bigint {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return 0n;
  return parseAmount(s, 18);
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(1) + "K";
  const d = a >= 100 ? 0 : a >= 1 ? 2 : Math.min(12, Math.ceil(-Math.log10(a)) + 2);
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function tickerFor(name: string): string {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter((w) => w && !["AND", "OF", "THE"].includes(w));
  if (words.length === 1) return words[0]!.slice(0, 10);
  const ini = words.map((w) => w[0]).join("");
  return ini.length >= 2 ? ini.slice(0, 10) : words.join("").slice(0, 10);
}

export const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function Flag({ id, size = 40, className }: { id: string; size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`mp-flag ${className ?? ""}`} src={`/flags/${id.toLowerCase()}.webp`} alt="" width={Math.round(size * 1.5)} height={size} loading="lazy" />
  );
}

type Msg = { tone: "info" | "error" | "success"; text: string; hash?: string } | null;
function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <Notice tone={msg.tone}>
      {msg.text}
      {msg.hash ? <> · <a href={explorerTx(msg.hash)} target="_blank" rel="noreferrer">view transaction</a></> : null}
    </Notice>
  );
}

// ---------------------------------------------------------------- stats
export function Stats({ token, currency, place, ethUsd }: { token: MapinToken; currency?: MapinToken; place: Place; ethUsd: number | null }) {
  const priceEth = Number(formatEther(token.priceEth));
  const mcapEth = priceEth * SUPPLY;
  const inCurrency = currency && currency.priceEth > 0n ? Number(token.priceEth) / Number(currency.priceEth) : null;
  const raised = Number(formatEther(token.realQuote));
  const usd = ethUsd ? mcapEth * ethUsd : null;
  return (
    <div className="mp-stats">
      <div><span className="mp-k">Price</span><b>{num(priceEth)} ETH</b>{inCurrency !== null ? <small>= {num(inCurrency)} ${currency!.symbol}</small> : null}</div>
      <div><span className="mp-k">Market cap</span><b>{num(mcapEth)} ETH</b><small>{usd !== null ? `≈ $${num(usd)} · ${num(usd * place.perUsd)} ${place.currency}` : " "}</small></div>
      <div><span className="mp-k">Raised</span><b>{num(raised)} {token.kind === 2 && currency ? `$${currency.symbol}` : "ETH"}</b></div>
      <div className="mp-wide">
        <div className="mp-row"><span className="mp-k">Bonding curve</span><span className="mono">{token.migrated ? "On Uniswap" : token.graduated ? "Graduated" : `${(token.progressBps / 100).toFixed(1)}%`}</span></div>
        <div className="mp-bar"><i style={{ width: `${Math.max(1, token.progressBps / 100)}%` }} /></div>
      </div>
      {token.meta ? <p className="mp-wide mp-meta">{token.meta}</p> : null}
      <a className="mp-wide mp-addr" href={explorerToken(token.address)} target="_blank" rel="noreferrer">{token.address}</a>
    </div>
  );
}

// ---------------------------------------------------------------- launch
/**
 * kind "country": any name and ticker, launched on `place` and paired with its currency coin. If the
 * currency coin does not exist yet, the same transaction launches it (name from the currency).
 * kind "currency": launch only the currency coin, paired with ETH.
 */
export function LaunchForm({ kind, place, currencyLive, onDone }: { kind: "currency" | "country"; place: Place; currencyLive: boolean; onDone?(token: Address | null): void }) {
  const tx = useMapinTx();
  const qc = useQueryClient();
  const isCountry = kind === "country";
  const [name, setName] = useState(isCountry ? "" : titleCase(place.currencyName));
  const [symbol, setSymbol] = useState(isCountry ? "" : place.currency);
  const [fee, setFee] = useState(50);
  const [meta, setMeta] = useState("");
  const [eth, setEth] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const cleanSym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!MAPIN_LAUNCHPAD) return setMsg({ tone: "error", text: "The launchpad contract is not set on this site yet." });
    setBusy(true);
    setMsg(null);
    try {
      const value = eth.trim() ? parseEther(eth.trim().replace(",", ".")) : 0n;
      if (!name.trim()) throw new Error("Give your token a name.");
      if (!cleanSym) throw new Error("Give your token a ticker (letters and numbers).");
      setMsg({ tone: "info", text: "Confirm the launch in your wallet…" });
      const params = { key: b32(isCountry ? place.id : place.currency), name: name.trim(), symbol: cleanSym, metadataURI: meta.trim(), creatorFeeBps: fee, minMidOut: 0n, minTokensOut: 0n };
      const receipt = isCountry
        ? await tx.send(MAPIN_LAUNCHPAD as Address, mapinAbi as Abi, "launchCountry", [params, titleCase(place.currencyName), place.currency], value, "Launch")
        : await tx.send(MAPIN_LAUNCHPAD as Address, mapinAbi as Abi, "launchCurrency", [params], value, "Launch");
      const token = tx.launchedToken(receipt, isCountry ? "CountryLaunched" : "CurrencyLaunched");
      setMsg({ tone: "success", text: `$${cleanSym} is live on ${isCountry ? place.name : place.currency}.`, hash: receipt.transactionHash });
      await qc.invalidateQueries({ queryKey: ["mapin-state"] });
      onDone?.(token);
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    }
    setBusy(false);
  }

  return (
    <form className="mp-form" onSubmit={submit}>
      <div className="mp-two">
        <label className="field"><span className="label">Token name</span><input className="input" value={name} maxLength={40} placeholder={isCountry ? `e.g. ${place.name} Pride` : ""} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="label">Ticker</span><input className="input" value={symbol} maxLength={10} placeholder={isCountry ? `e.g. ${tickerFor(place.name)}` : ""} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
      </div>
      {isCountry ? (
        <div className="mp-pairhint">
          <span className="mp-k">Pair</span>
          <b>${cleanSym || "TICKER"}</b><em>/</em><b>${place.currency}</b>
          {!currencyLive ? <small>The ${place.currency} coin does not exist yet. This launch creates it too, and you become its creator.</small> : null}
        </div>
      ) : null}
      <label className="field"><span className="label">Your creator fee: {(fee / 100).toFixed(2)}% of every trade</span>
        <input type="range" min={0} max={100} step={5} value={fee} onChange={(e) => setFee(Number(e.target.value))} /></label>
      <label className="field"><span className="label">Logo link or description (optional)</span><input className="input" value={meta} maxLength={280} placeholder="https://… or one line about the token" onChange={(e) => setMeta(e.target.value)} /></label>
      <label className="field"><span className="label">First buy in ETH (optional)</span><input className="input" inputMode="decimal" placeholder="0.00" value={eth} onChange={(e) => setEth(e.target.value)} /></label>
      {tx.address ? (
        <button type="submit" className="btn btn-yellow btn-lg btn-block" disabled={busy}>{busy ? <span className="spinner" aria-hidden /> : null}Launch ${cleanSym || "token"}</button>
      ) : (
        <ConnectButton block />
      )}
      <p className="mp-fine">Supply 1,000,000,000. 80% sells on the bonding curve; the rest seeds the DEX pool when it graduates. Platform fee 1% per trade.</p>
      <Status msg={msg} />
    </form>
  );
}

// ---------------------------------------------------------------- trade
export function TradeBox({ token, currency }: { token: MapinToken; currency?: MapinToken }) {
  const tx = useMapinTx();
  const qc = useQueryClient();
  const isCountry = token.kind === 2;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [payWith, setPayWith] = useState<"eth" | "currency">("eth");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<{ out: bigint; mid: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const direct = isCountry && payWith === "currency" && !token.graduated;
  const quoteSym = direct && currency ? `$${currency.symbol}` : "ETH";
  const ethBal = useBalance({ address: tx.address, chainId: CHAIN_ID, query: { enabled: Boolean(tx.address) } });
  const tokBal = useReadContract({ address: token.address, abi: launchTokenAbi, functionName: "balanceOf", args: tx.address ? [tx.address] : undefined, chainId: CHAIN_ID, query: { enabled: Boolean(tx.address) } });
  const curBal = useReadContract({ address: currency?.address, abi: launchTokenAbi, functionName: "balanceOf", args: tx.address ? [tx.address] : undefined, chainId: CHAIN_ID, query: { enabled: Boolean(tx.address && currency) } });
  const inBal = side === "sell" ? tokBal.data : direct ? curBal.data : ethBal.data?.value;
  const inSym = side === "sell" ? `$${token.symbol}` : quoteSym;
  const outSym = side === "sell" ? quoteSym : `$${token.symbol}`;

  function reset() { setAmount(""); setPreview(null); setMsg(null); }

  async function quote(raw: string) {
    setAmount(raw);
    setPreview(null);
    if (!tx.pc || !MAPIN_LAUNCHPAD || !raw.trim()) return;
    try {
      const amt = parseUser(raw);
      if (amt === 0n) return;
      const lp = MAPIN_LAUNCHPAD as Address;
      if (side === "buy" && !direct) {
        const [mid, out] = await tx.pc.readContract({ address: lp, abi: mapinAbi, functionName: "previewBuyWithETH", args: [token.address, amt] });
        setPreview({ out, mid });
      } else if (side === "sell" && !direct) {
        const [mid, out] = await tx.pc.readContract({ address: lp, abi: mapinAbi, functionName: "previewSellForETH", args: [token.address, amt] });
        setPreview({ out, mid });
      } else if (side === "buy") {
        const [out] = await tx.pc.readContract({ address: lp, abi: mapinAbi, functionName: "previewBuy", args: [token.address, amt] });
        setPreview({ out, mid: 0n });
      } else {
        const [out] = await tx.pc.readContract({ address: lp, abi: mapinAbi, functionName: "previewSell", args: [token.address, amt] });
        setPreview({ out, mid: 0n });
      }
    } catch {
      setPreview(null);
    }
  }

  async function trade() {
    if (!preview || !tx.pc) return;
    setBusy(true);
    setMsg(null);
    try {
      const amt = parseUser(amount);
      if (amt === 0n) throw new Error("Enter an amount.");
      if (inBal !== undefined && amt > inBal) throw new Error(`Not enough ${inSym}.`);
      const lp = MAPIN_LAUNCHPAD as Address;
      const min = minOut(preview.out);
      const minMid = minOut(preview.mid);
      let receipt;
      if (side === "buy" && !direct) {
        setMsg({ tone: "info", text: "Confirm the buy in your wallet…" });
        receipt = await tx.send(lp, mapinAbi as Abi, "buyWithETH", [token.address, minMid, min, deadline()], amt, "Buy");
      } else if (side === "sell" && !direct) {
        await tx.ensureAllowance(token.address, amt, `$${token.symbol}`);
        setMsg({ tone: "info", text: "Confirm the sell in your wallet…" });
        receipt = await tx.send(lp, mapinAbi as Abi, "sellForETH", [token.address, amt, minMid, min, deadline()], 0n, "Sell");
      } else if (side === "buy") {
        await tx.ensureAllowance(currency!.address, amt, `$${currency!.symbol}`);
        setMsg({ tone: "info", text: "Confirm the buy in your wallet…" });
        receipt = await tx.send(lp, mapinAbi as Abi, "buy", [token.address, amt, min, deadline()], 0n, "Buy");
      } else {
        await tx.ensureAllowance(token.address, amt, `$${token.symbol}`);
        setMsg({ tone: "info", text: "Confirm the sell in your wallet…" });
        receipt = await tx.send(lp, mapinAbi as Abi, "sell", [token.address, amt, min, deadline()], 0n, "Sell");
      }
      setMsg({ tone: "success", text: side === "buy" ? `Bought $${token.symbol}.` : `Sold $${token.symbol}.`, hash: receipt.transactionHash });
      setAmount("");
      setPreview(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ["mapin-state"] }), ethBal.refetch(), tokBal.refetch(), curBal.refetch()]);
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    }
    setBusy(false);
  }

  // Curve full but liquidity not in the Uniswap pair yet (the automatic step failed): anyone can finish it.
  if (token.graduated && !token.migrated) {
    return <MigrateBox token={token} />;
  }
  // Direct currency-coin trades use the curve only; after graduation everything routes with ETH through the pools.
  const directAllowed = isCountry && Boolean(currency) && !token.graduated;
  const ethRouteBlocked = !direct && isCountry && Boolean(currency?.graduated && !currency?.migrated);
  const maxIn = inBal ? (side === "buy" && !direct ? (inBal * 97n) / 100n : inBal) : 0n;

  return (
    <div className="mp-trade">
      <div className="mp-seg" role="group" aria-label="Buy or sell">
        <button type="button" className="b" aria-pressed={side === "buy"} onClick={() => { setSide("buy"); reset(); }}>Buy</button>
        <button type="button" className="s" aria-pressed={side === "sell"} onClick={() => { setSide("sell"); reset(); }}>Sell</button>
      </div>
      {token.migrated ? <Notice tone="success" title="Graduated · trading on Uniswap">Buys and sells route with ETH through the Uniswap V2 pool ${token.symbol}/{isCountry ? `$${currency?.symbol ?? "?"}` : "WETH"}.</Notice> : null}
      {directAllowed && currency ? (
        <div className="mp-chips" role="group" aria-label="Pay with">
          <span className="mp-k">{side === "buy" ? "Pay with" : "Receive"}</span>
          <button type="button" aria-pressed={payWith === "eth"} onClick={() => { setPayWith("eth"); reset(); }}>ETH</button>
          <button type="button" aria-pressed={payWith === "currency"} onClick={() => { setPayWith("currency"); reset(); }}>${currency.symbol}</button>
        </div>
      ) : null}
      <label className="field">
        <span className="label">{side === "buy" ? `You pay (${inSym})` : `You sell (${inSym})`}</span>
        <input className="input mp-amount" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => void quote(e.target.value)} />
      </label>
      <div className="mp-row mp-fine">
        <span>Balance: {inBal !== undefined ? formatAmount(inBal, 18, 6) : "–"} {inSym}</span>
        {maxIn > 0n ? <button type="button" className="mp-link" onClick={() => void quote(formatAmount(maxIn, 18, 18).replace(/,/g, ""))}>Max</button> : null}
      </div>
      <div className="mp-out">
        <span className="mp-k">You get about</span>
        <b>{preview ? `${formatAmount(preview.out, 18, 6)} ${outSym}` : "–"}</b>
        {preview && preview.mid > 0n && currency ? <small>routed through {formatAmount(preview.mid, 18, 2)} ${currency.symbol}</small> : null}
      </div>
      {ethRouteBlocked ? <Notice tone="warn">${currency!.symbol} just graduated; its Uniswap pool is being created. Pay with ${currency!.symbol} for now, or try again in a minute.</Notice> : null}
      {tx.address ? (
        <button type="button" className={`btn btn-lg btn-block ${side === "buy" ? "mp-buy" : "mp-sell"}`} disabled={busy || !preview || preview.out === 0n || ethRouteBlocked} onClick={() => void trade()}>
          {busy ? <span className="spinner" aria-hidden /> : null}{side === "buy" ? `Buy $${token.symbol}` : `Sell $${token.symbol}`}
        </button>
      ) : (
        <ConnectButton block />
      )}
      <p className="mp-fine">Max slippage 3%. Fees: 1% platform + creator fee{isCountry && !direct ? ", on each of the two curves" : ""}.</p>
      <Status msg={msg} />
    </div>
  );
}

// ---------------------------------------------------------------- lists
export function timeAgo(sec: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Place a token belongs to: the country for a country token, the first country using it for a currency coin. */
export function placeOf(t: MapinToken): Place | null {
  return t.kind === 2 ? PLACE.get(t.key) ?? null : PLACES.find((p) => p.currency === t.key) ?? null;
}

export const NEW_WINDOW_SEC = 24 * 3600;

export function TokenCard({ token, quoteSymbol, ethUsd }: { token: MapinToken; quoteSymbol: string; ethUsd: number | null }) {
  const place = placeOf(token);
  const price = Number(formatEther(token.priceEth));
  const mcap = price * SUPPLY;
  const isNew = Date.now() / 1000 - token.createdAt < NEW_WINDOW_SEC;
  return (
    <a className="mp-tcard" href={`/t/${token.address}`}>
      <div className="mp-tcard-top">
        {place ? <Flag id={place.id} size={30} /> : null}
        <div className="mp-tcard-id">
          <b>${token.symbol}</b>
          <span>{token.name}</span>
        </div>
        {token.migrated ? <em className="mp-tag grad">On Uniswap</em> : token.graduated ? <em className="mp-tag grad">Graduated</em> : isNew ? <em className="mp-tag new">New</em> : token.kind === 1 ? <em className="mp-tag cur">Currency</em> : null}
      </div>
      <div className="mp-tcard-pair">{token.kind === 2 ? `${place?.name ?? token.key} · ` : ""}${token.symbol} / {quoteSymbol}</div>
      <div className="mp-tcard-nums">
        <span><small>Mcap</small>{num(mcap)} ETH{ethUsd ? <i> ≈ ${num(mcap * ethUsd)}</i> : null}</span>
        <span><small>Age</small>{timeAgo(token.createdAt)}</span>
      </div>
      <div className="mp-bar"><i style={{ width: `${Math.max(1, token.progressBps / 100)}%` }} /></div>
      <div className="mp-tcard-foot"><span>{(token.progressBps / 100).toFixed(1)}% to graduation</span><span>fee {(token.creatorFeeBps / 100).toFixed(2)}%</span></div>
    </a>
  );
}

// ---------------------------------------------------------------- graduation fallback
function MigrateBox({ token }: { token: MapinToken }) {
  const tx = useMapinTx();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  async function go() {
    setBusy(true);
    setMsg({ tone: "info", text: "Confirm in your wallet…" });
    try {
      const r = await tx.send(MAPIN_LAUNCHPAD as Address, mapinAbi as Abi, "migrateToDex", [token.address], 0n, "Create pool");
      setMsg({ tone: "success", text: "Liquidity is in the Uniswap pool. Trading is open.", hash: r.transactionHash });
      await qc.invalidateQueries({ queryKey: ["mapin-state"] });
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    }
    setBusy(false);
  }
  return (
    <div className="mp-trade">
      <Notice tone="success" title="Graduated">The bonding curve sold out. One step left: move the liquidity into the Uniswap V2 pool. Anyone can do it; it costs only gas.</Notice>
      {tx.address ? (
        <button type="button" className="btn btn-yellow btn-lg btn-block" disabled={busy} onClick={() => void go()}>{busy ? <span className="spinner" aria-hidden /> : null}Create the Uniswap pool</button>
      ) : <ConnectButton block />}
      <Status msg={msg} />
    </div>
  );
}
