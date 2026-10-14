"use client";

import { useMemo, useState, type FormEvent } from "react";
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
import { CountryMap, type CountryStatus } from "@/components/countries/CountryMap";
import { useEthUsd, useMapinState, useMapinTx, type MapinToken } from "@/components/countries/useMapin";

interface Place { id: string; name: string; flag: string; currency: string; currencyName: string; currencySymbol: string; perUsd: number }
const PLACES = places as Place[];
const PLACE = new Map(PLACES.map((p) => [p.id, p]));
const SLIPPAGE_BPS = 300n; // 3 %: a country buy crosses two curves
const SUPPLY = 1_000_000_000;

const b32 = (s: string) => stringToHex(s, { size: 32 });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const minOut = (v: bigint) => (v * (10_000n - SLIPPAGE_BPS)) / 10_000n;

function num(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  if (n === 0) return "0";
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : a >= 1 ? 2 : Math.min(12, Math.ceil(-Math.log10(a)) + 3);
  return n.toLocaleString("id-ID", { maximumFractionDigits: d });
}
function tickerFor(name: string): string {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter((w) => w && !["AND", "OF", "THE"].includes(w));
  if (words.length === 1) return words[0]!.slice(0, 10);
  const ini = words.map((w) => w[0]).join("");
  return ini.length >= 2 ? ini.slice(0, 10) : words.join("").slice(0, 10);
}

export function CountryHome() {
  const state = useMapinState();
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const status = useMemo(() => {
    const s: Record<string, CountryStatus> = {};
    if (!state.data) return s;
    for (const p of PLACES) {
      const c = state.data.countries.get(p.id);
      if (c) s[p.id] = c.graduated ? "graduated" : "live";
      else if (state.data.currencies.has(p.currency)) s[p.id] = "currency";
    }
    return s;
  }, [state.data]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return PLACES.filter((p) => p.name.toLowerCase().includes(s) || p.currency.toLowerCase() === s || p.currencyName.toLowerCase().includes(s)).slice(0, 8);
  }, [q]);

  const latest = useMemo(() => {
    if (!state.data) return [];
    return [...state.data.countries.values()].slice(-12).reverse();
  }, [state.data]);

  return (
    <div className="map-home chome">
      <CountryMap status={status} selected={selected} onSelect={setSelected} />

      <div className="chome-search">
        <input className="input" placeholder="Cari negara atau mata uang (Algeria, MYR…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari negara" />
        {hits.length ? (
          <div className="chome-results">
            {hits.map((p) => (
              <button key={p.id} type="button" onClick={() => { setSelected(p.id); setQ(""); }}>
                <span>{p.flag} {p.name}</span><span className="muted">{p.currency}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {latest.length ? (
        <div className="chome-strip" aria-label="Token negara terbaru">
          {latest.map((t) => {
            const p = PLACE.get(t.key);
            return p ? <button key={t.address} type="button" onClick={() => setSelected(p.id)}>{p.flag} ${t.symbol}<span className="muted">/{p.currency}</span></button> : null;
          })}
        </div>
      ) : null}

      <div className="chome-legend">
        <span><i style={{ background: "rgba(43,29,16,0.08)" }} />Belum ada</span>
        <span><i style={{ background: "rgba(255,196,0,0.35)" }} />Token mata uang ada</span>
        <span><i style={{ background: "#ffc400" }} />Token negara live</span>
        <span><i style={{ background: "#2f6b3f" }} />Lulus</span>
      </div>

      {!MAPIN_LAUNCHPAD ? (
        <div className="chome-banner"><Notice tone="error" title="Kontrak belum dihubungkan">Deploy MapinLaunchpad (folder contracts) lalu isi NEXT_PUBLIC_MAPIN_LAUNCHPAD.</Notice></div>
      ) : state.error ? (
        <div className="chome-banner"><Notice tone="error" title="Gagal membaca chain">{(state.error as Error).message.slice(0, 160)}</Notice></div>
      ) : null}

      {selected && PLACE.get(selected) ? (
        <CountryPanel key={selected} place={PLACE.get(selected)!} data={state.data} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function CountryPanel({ place, data, onClose }: { place: Place; data: ReturnType<typeof useMapinState>["data"]; onClose(): void }) {
  const currency = data?.currencies.get(place.currency);
  const country = data?.countries.get(place.id);
  const ethUsd = useEthUsd().data ?? null;
  const toLocal = (eth: number) => (ethUsd ? eth * ethUsd * place.perUsd : null);

  return (
    <aside className="chome-panel" aria-live="polite">
      <div className="chome-ph">
        <span className="chome-flag">{place.flag}</span>
        <div style={{ minWidth: 0 }}>
          <h2>{place.name}</h2>
          <div className="hint">{place.currencyName} · {place.currency}{place.currencySymbol ? ` · ${place.currencySymbol}` : ""}</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Tutup">Tutup</button>
      </div>

      <div className="chome-pair">
        <b>${country?.symbol ?? tickerFor(place.name)}</b><span>/</span><b>${currency?.symbol ?? place.currency}</b><span className="muted">/</span><b>ETH</b>
      </div>

      {/* ---------------- country layer */}
      <section className="card card-flat chome-sec">
        <div className="panel-title">Token negara</div>
        {country ? (
          <>
            <Stats token={country} currency={currency} toLocal={toLocal} place={place} />
            <TradeBox token={country} currency={currency} />
          </>
        ) : !currency ? (
          <p className="hint">Token {place.name} dipasangkan ke token ${place.currency}. Luncurkan token mata uang {place.currencyName} dulu di bawah.</p>
        ) : (
          <LaunchForm kind="country" place={place} />
        )}
      </section>

      {/* ---------------- currency layer */}
      <section className="card card-flat chome-sec">
        <div className="panel-title">Token mata uang ${currency?.symbol ?? place.currency}</div>
        {currency ? (
          <>
            <Stats token={currency} toLocal={toLocal} place={place} />
            <TradeBox token={currency} />
          </>
        ) : (
          <LaunchForm kind="currency" place={place} />
        )}
        <p className="hint">Token bertema mata uang dengan harga pasar bebas. Bukan stablecoin, dan nilainya tidak sama dengan {place.currencyName} asli.</p>
      </section>
    </aside>
  );
}

function Stats({ token, currency, toLocal, place }: { token: MapinToken; currency?: MapinToken; toLocal(eth: number): number | null; place: Place }) {
  const priceEth = Number(formatEther(token.priceEth));
  const mcapEth = priceEth * SUPPLY;
  const inCurrency = currency && currency.priceEth > 0n ? Number(token.priceEth) / Number(currency.priceEth) : null;
  const raised = Number(formatEther(token.realQuote));
  return (
    <div className="chome-stats">
      <div><span className="label">Harga</span><b>{num(priceEth)} ETH</b>{inCurrency !== null ? <small>= {num(inCurrency)} ${currency!.symbol}</small> : null}</div>
      <div><span className="label">Market cap</span><b>{num(mcapEth)} ETH</b><small>≈ {num(toLocal(mcapEth))} {place.currency}</small></div>
      <div><span className="label">Terkumpul</span><b>{num(raised)} {token.kind === 2 && currency ? `$${currency.symbol}` : "ETH"}</b></div>
      <div className="chome-prog">
        <div className="row"><span className="label">Menuju lulus</span><span>{token.graduated ? "Lulus" : `${(token.progressBps / 100).toFixed(1)}%`}</span></div>
        <div className="chome-bar"><i style={{ width: `${token.progressBps / 100}%` }} /></div>
      </div>
      {token.meta ? <p className="hint chome-meta">{token.meta}</p> : null}
      <a className="hint" href={explorerToken(token.address)} target="_blank" rel="noreferrer">{token.address}</a>
    </div>
  );
}

function LaunchForm({ kind, place }: { kind: "currency" | "country"; place: Place }) {
  const tx = useMapinTx();
  const qc = useQueryClient();
  const isCountry = kind === "country";
  const [name, setName] = useState(isCountry ? place.name : place.currencyName.replace(/\b\w/g, (c) => c.toUpperCase()));
  const [symbol, setSymbol] = useState(isCountry ? tickerFor(place.name) : place.currency);
  const [fee, setFee] = useState(50);
  const [meta, setMeta] = useState("");
  const [eth, setEth] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "error" | "success"; text: string; hash?: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!MAPIN_LAUNCHPAD) return;
    setBusy(true);
    setMsg(null);
    try {
      const value = eth.trim() ? parseEther(eth.trim().replace(",", ".")) : 0n;
      const sym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!name.trim() || !sym) throw new Error("Isi nama dan ticker.");
      setMsg({ tone: "info", text: "Konfirmasi peluncuran di wallet…" });
      const params = { key: b32(isCountry ? place.id : place.currency), name: name.trim(), symbol: sym, metadataURI: meta.trim(), creatorFeeBps: fee, minMidOut: 0n, minTokensOut: 0n };
      const receipt = await tx.send(MAPIN_LAUNCHPAD as Address, mapinAbi as Abi, isCountry ? "launchCountry" : "launchCurrency", [params], value, "Peluncuran");
      setMsg({ tone: "success", text: `$${sym} berhasil diluncurkan.`, hash: receipt.transactionHash });
      await qc.invalidateQueries({ queryKey: ["mapin-state"] });
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    }
    setBusy(false);
  }

  return (
    <form className="chome-form" onSubmit={submit}>
      <p className="hint">
        {isCountry
          ? `Belum ada token ${place.name}. Peluncur pertama mendapat creator fee dari setiap transaksi. Pair: $${symbol || "…"} / $${place.currency}.`
          : `Belum ada token untuk ${place.currencyName}. Semua negara yang memakai ${place.currency} akan dipasangkan ke token ini. Pair: $${symbol || "…"} / ETH.`}
      </p>
      <div className="chome-two">
        <label className="field"><span className="label">Nama</span><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="label">Ticker</span><input className="input" value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
      </div>
      <label className="field"><span className="label">Creator fee {(fee / 100).toFixed(2)}% per transaksi</span>
        <input type="range" min={0} max={100} step={5} value={fee} onChange={(e) => setFee(Number(e.target.value))} /></label>
      <label className="field"><span className="label">Link logo / deskripsi (opsional)</span><input className="input" value={meta} maxLength={280} onChange={(e) => setMeta(e.target.value)} /></label>
      <label className="field"><span className="label">Beli awal (ETH, opsional)</span><input className="input" inputMode="decimal" placeholder="0" value={eth} onChange={(e) => setEth(e.target.value)} /></label>
      {tx.address ? (
        <button type="submit" className="btn btn-yellow btn-block" disabled={busy}>{busy ? <span className="spinner" aria-hidden /> : null}Luncurkan ${symbol || "…"}</button>
      ) : (
        <ConnectButton block />
      )}
      {msg ? <Notice tone={msg.tone}>{msg.text}{msg.hash ? <> · <a href={explorerTx(msg.hash)} target="_blank" rel="noreferrer">lihat transaksi</a></> : null}</Notice> : null}
    </form>
  );
}

function TradeBox({ token, currency }: { token: MapinToken; currency?: MapinToken }) {
  const tx = useMapinTx();
  const qc = useQueryClient();
  const isCountry = token.kind === 2;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [payWith, setPayWith] = useState<"eth" | "currency">("eth");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<{ out: bigint; mid: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "error" | "success"; text: string; hash?: string } | null>(null);

  const direct = isCountry && payWith === "currency";
  const quoteSym = direct && currency ? `$${currency.symbol}` : "ETH";
  const ethBal = useBalance({ address: tx.address, chainId: CHAIN_ID, query: { enabled: Boolean(tx.address) } });
  const tokBal = useReadContract({ address: token.address, abi: launchTokenAbi, functionName: "balanceOf", args: tx.address ? [tx.address] : undefined, chainId: CHAIN_ID, query: { enabled: Boolean(tx.address) } });
  const curBal = useReadContract({ address: currency?.address, abi: launchTokenAbi, functionName: "balanceOf", args: tx.address ? [tx.address] : undefined, chainId: CHAIN_ID, query: { enabled: Boolean(tx.address && currency) } });
  const inBal = side === "sell" ? tokBal.data : direct ? curBal.data : ethBal.data?.value;
  const inSym = side === "sell" ? `$${token.symbol}` : quoteSym;
  const outSym = side === "sell" ? quoteSym : `$${token.symbol}`;

  async function quote(raw: string) {
    setAmount(raw);
    setPreview(null);
    if (!tx.pc || !raw.trim()) return;
    try {
      const amt = parseAmount(raw.trim().replace(",", "."), 18);
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
      const amt = parseAmount(amount.trim().replace(",", "."), 18);
      const lp = MAPIN_LAUNCHPAD as Address;
      const min = minOut(preview.out);
      const minMid = minOut(preview.mid);
      let receipt;
      if (side === "buy" && !direct) {
        setMsg({ tone: "info", text: "Konfirmasi pembelian di wallet…" });
        receipt = await tx.send(lp, mapinAbi as Abi, "buyWithETH", [token.address, minMid, min, deadline()], amt, "Pembelian");
      } else if (side === "sell" && !direct) {
        await tx.ensureAllowance(token.address, amt, `$${token.symbol}`);
        setMsg({ tone: "info", text: "Konfirmasi penjualan di wallet…" });
        receipt = await tx.send(lp, mapinAbi as Abi, "sellForETH", [token.address, amt, minMid, min, deadline()], 0n, "Penjualan");
      } else if (side === "buy") {
        await tx.ensureAllowance(currency!.address, amt, `$${currency!.symbol}`);
        setMsg({ tone: "info", text: "Konfirmasi pembelian di wallet…" });
        receipt = await tx.send(lp, mapinAbi as Abi, "buy", [token.address, amt, min, deadline()], 0n, "Pembelian");
      } else {
        await tx.ensureAllowance(token.address, amt, `$${token.symbol}`);
        setMsg({ tone: "info", text: "Konfirmasi penjualan di wallet…" });
        receipt = await tx.send(lp, mapinAbi as Abi, "sell", [token.address, amt, min, deadline()], 0n, "Penjualan");
      }
      setMsg({ tone: "success", text: side === "buy" ? `Berhasil membeli $${token.symbol}.` : `Berhasil menjual $${token.symbol}.`, hash: receipt.transactionHash });
      setAmount("");
      setPreview(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ["mapin-state"] }), ethBal.refetch(), tokBal.refetch(), curBal.refetch()]);
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    }
    setBusy(false);
  }

  if (token.graduated) return <Notice tone="success" title="Sudah lulus">Bonding curve penuh. Perdagangan berlanjut di pool DEX setelah migrasi.</Notice>;
  const ethRouteBlocked = isCountry && !direct && currency?.graduated;

  return (
    <div className="chome-trade">
      <div className="seg" role="group" aria-label="Beli atau jual">
        <button type="button" aria-pressed={side === "buy"} onClick={() => { setSide("buy"); setAmount(""); setPreview(null); }}>Beli</button>
        <button type="button" aria-pressed={side === "sell"} onClick={() => { setSide("sell"); setAmount(""); setPreview(null); }}>Jual</button>
      </div>
      {isCountry && currency ? (
        <div className="seg" role="group" aria-label="Mata uang pembayaran">
          <button type="button" aria-pressed={payWith === "eth"} onClick={() => { setPayWith("eth"); setAmount(""); setPreview(null); }}>ETH</button>
          <button type="button" aria-pressed={payWith === "currency"} onClick={() => { setPayWith("currency"); setAmount(""); setPreview(null); }}>${currency.symbol}</button>
        </div>
      ) : null}
      <label className="field">
        <span className="label">{side === "buy" ? `Bayar (${inSym})` : `Jual (${inSym})`}</span>
        <input className="input" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => void quote(e.target.value)} />
      </label>
      <div className="row hint">
        <span>Saldo: {inBal !== undefined ? formatAmount(inBal, 18, 6) : "–"} {inSym}</span>
        {inBal ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => void quote(formatAmount(side === "buy" && !direct ? (inBal * 97n) / 100n : inBal, 18, 18).replace(/,/g, ""))}>Maks</button> : null}
      </div>
      <div className="chome-out">
        {preview ? <>≈ {formatAmount(preview.out, 18, 6)} {outSym}{preview.mid > 0n && currency ? <span className="muted"> · lewat {formatAmount(preview.mid, 18, 2)} ${currency.symbol}</span> : null}</> : "–"}
      </div>
      {ethRouteBlocked ? <Notice tone="warn">${currency!.symbol} sudah lulus dari curve. Bayar langsung pakai ${currency!.symbol}.</Notice> : null}
      {tx.address ? (
        <button type="button" className="btn btn-yellow btn-block" disabled={busy || !preview || preview.out === 0n || Boolean(ethRouteBlocked)} onClick={() => void trade()}>
          {busy ? <span className="spinner" aria-hidden /> : null}{side === "buy" ? `Beli $${token.symbol}` : `Jual $${token.symbol}`}
        </button>
      ) : (
        <ConnectButton block />
      )}
      <p className="hint">Slippage maks 3%. Biaya platform 1% + creator fee{isCountry && !direct ? " di tiap curve yang dilewati" : ""}.</p>
      {msg ? <Notice tone={msg.tone}>{msg.text}{msg.hash ? <> · <a href={explorerTx(msg.hash)} target="_blank" rel="noreferrer">lihat transaksi</a></> : null}</Notice> : null}
    </div>
  );
}
