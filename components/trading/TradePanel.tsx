"use client";

import { useEffect, useMemo, useState } from "react";
import { useConfig, useConnection, useBalance, usePublicClient, useReadContract } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useWallets } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createWalletClient, custom, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { robinhoodChain } from "@/lib/chain/robinhood";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { permit2Abi, ponsCurveAbi, ponsFactoryAbi } from "@/lib/contracts/pons-abi";
import { CHAIN_ID, CHAIN_NAME, GraduationPhase, PERMIT2, PONS_FACTORY, UNIVERSAL_ROUTER, ZERO_ADDRESS } from "@/lib/contracts/constants";
import { curveStateOf, quoteDex, readLensState, readSnipeTaxBps, verifyDexPool } from "@/lib/market/onchain";
import { buyMinTokensOut, quoteBuy, quoteSell } from "@/lib/market/curve-math";
import { buildV4ExactInSwap, type PoolKey } from "@/lib/market/v4";
import { applySlippage, bpsOf, deadlineFromNow, DEFAULT_SLIPPAGE_BPS, priceImpactBps, slippagePercentToBps } from "@/lib/market/math";
import { formatAmount, parseAmount, ValidationError } from "@/lib/validation/normalize";
import { decodeError } from "@/lib/errors/decode";
import { explorerTx } from "@/lib/config/public";
import { Notice } from "@/components/ui/Notice";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import type { MarketChainState } from "@/hooks/useMarketChain";

type Side = "buy" | "sell";
type Signer = Awaited<ReturnType<typeof getWalletClient>>;
const MAX_GAS = 30_000_000n;
const clampGas = (g: bigint) => ((g * 13n) / 10n > MAX_GAS ? MAX_GAS : (g * 13n) / 10n);
const SLIPPAGE_PRESETS = [50, 100, 300, 500];
const TOKEN_DECIMALS = 18; // Pons tokens are 18 decimals; re-read on-chain below
const PERMIT2_TTL_SECONDS = 30 * 60;

interface Props {
  token: Address;
  symbol: string;
  quote: { address: Address; symbol: string; decimals: number };
  chain: MarketChainState | undefined;
  chainError: string | null;
}

interface Quote {
  out: bigint;
  min: bigint;
  /** quote actually charged on a buy (may be below the amount entered when the buy fills the curve) */
  spent: bigint | null;
  spot: bigint;
  snipeBps: bigint;
}

export function TradePanel({ token, symbol, quote, chain, chainError }: Props) {
  const { address, isConnected, chainId } = useConnection();
  // Use the SAME wagmi config instance the provider uses (the imported one can be a different, unconnected copy).
  const config = useConfig();
  const { wallets } = useWallets();
  const client = usePublicClient({ chainId: CHAIN_ID }) as unknown as PublicClient | undefined;
  const qc = useQueryClient();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [debounced, setDebounced] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [customSlip, setCustomSlip] = useState("");
  const [status, setStatus] = useState<{ tone: "info" | "error" | "success"; text: string; hash?: Hex } | null>(null);
  const [busy, setBusy] = useState(false);

  // Get a signer. Try wagmi first; if its connector dropped (common on mobile), fall back to the Privy wallet directly.
  async function getSigner(): Promise<Signer> {
    try {
      return await getWalletClient(config, { chainId: CHAIN_ID });
    } catch {
      const w = wallets.find((x) => address && x.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
      if (!w) throw new Error("Wallet disconnected. Reconnect your wallet and try again.");
      try {
        await w.switchChain(CHAIN_ID);
      } catch {
        /* wallet may already be on Robinhood Chain or not support switching; the tx still targets robinhoodChain */
      }
      const provider = await w.getEthereumProvider();
      return createWalletClient({ account: w.address as Address, chain: robinhoodChain, transport: custom(provider) }) as unknown as Signer;
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDebounced(amount.trim()), 350);
    return () => clearTimeout(t);
  }, [amount]);

  const native = quote.address.toLowerCase() === ZERO_ADDRESS;
  const route = chain?.route;
  const onChain = chainId === CHAIN_ID;

  const tokenDecimals = useReadContract({ address: token, abi: erc20Abi, functionName: "decimals", chainId: CHAIN_ID });
  const tDec = tokenDecimals.data !== undefined ? Number(tokenDecimals.data) : TOKEN_DECIMALS;
  const ethBal = useBalance({ address, chainId: CHAIN_ID, query: { enabled: Boolean(address) } });
  const quoteBal = useReadContract({
    address: quote.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: CHAIN_ID,
    query: { enabled: Boolean(address) && !native },
  });
  const tokenBal = useReadContract({
    address: token, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const inDecimals = side === "buy" ? quote.decimals : tDec;
  const outDecimals = side === "buy" ? tDec : quote.decimals;
  const inSymbol = side === "buy" ? quote.symbol : symbol;
  const outSymbol = side === "buy" ? symbol : quote.symbol;
  const inBalance: bigint | undefined = side === "buy" ? (native ? ethBal.data?.value : quoteBal.data) : tokenBal.data;

  const parsed = useMemo(() => {
    if (!debounced) return { value: null as bigint | null, error: null as string | null };
    try {
      const v = parseAmount(debounced, inDecimals);
      return { value: v > 0n ? v : null, error: v > 0n ? null : "Enter an amount above 0" };
    } catch (err) {
      return { value: null, error: err instanceof ValidationError ? err.message : "Invalid amount" };
    }
  }, [debounced, inDecimals]);

  /** Price a trade against fresh on-chain state (never a cached quote). */
  async function priceTrade(pc: PublicClient, st: MarketChainState, amountIn: bigint, slip: number): Promise<Quote> {
    const r = st.route;
    if (r.kind === "curve") {
      const cs = curveStateOf(st.lens);
      if (side === "buy") {
        const snipeBps = await readSnipeTaxBps(pc, r.curve as Address, address);
        const q = quoteBuy(cs, amountIn, snipeBps);
        return { out: q.tokensOut, min: buyMinTokensOut(q, slip), spent: q.spent, spot: st.lens.price, snipeBps };
      }
      const q = quoteSell(cs, amountIn);
      return { out: q.quoteOut, min: applySlippage(q.quoteOut, slip), spent: null, spot: st.lens.price, snipeBps: 0n };
    }
    if (r.kind === "dex") {
      const currencyIn = side === "buy" ? quote.address : token;
      const out = await quoteDex(pc, { key: r.key, currencyIn, amountIn });
      return { out, min: applySlippage(out, slip), spent: null, spot: st.lens.price, snipeBps: 0n };
    }
    throw new Error("This market cannot be traded right now.");
  }

  const quoteQuery = useQuery({
    queryKey: ["trade-quote", token, side, parsed.value?.toString(), route?.kind, chain?.lens.status, chain?.lens.quoteReserve.toString(), slippageBps, address],
    enabled: Boolean(client && chain && parsed.value && route && (route.kind === "curve" || route.kind === "dex")),
    refetchInterval: 10_000,
    queryFn: () => priceTrade(client!, chain!, parsed.value!, slippageBps),
  });

  const out = quoteQuery.data?.out ?? null;
  const minOut = quoteQuery.data && quoteQuery.data.out > 0n ? quoteQuery.data.min : null;
  const effectiveIn = quoteQuery.data?.spent ?? parsed.value;
  const impact =
    out !== null && effectiveIn && quoteQuery.data
      ? priceImpactBps({ side, spotPriceWad: quoteQuery.data.spot, amountIn: effectiveIn, amountOut: out, quoteDecimals: quote.decimals, tokenDecimals: tDec })
      : null;
  const creatorFeeBps = chain ? chain.lens.buyTaxRate : 0n;
  const curveFeeBps = route?.kind === "curve" && chain ? chain.lens.curveFeeBps : null;
  const insufficient = parsed.value !== null && inBalance !== undefined && parsed.value > inBalance;

  async function sendTx(pc: PublicClient, to: Address, data: Hex, value: bigint, label: string): Promise<Hex> {
    const gas = clampGas(await pc.estimateGas({ account: address!, to, data, value }));
    const wc = await getSigner();
    let hash: Hex;
    try {
      hash = await wc.sendTransaction({ account: address!, to, data, value, gas, chain: robinhoodChain });
    } catch (err) {
      const d = decodeError(err, label);
      throw new Error(d.kind === "rejected" ? `${label} rejected in your wallet.` : d.message);
    }
    setStatus({ tone: "info", text: `${label} submitted — confirming…`, hash });
    let finalHash = hash;
    const receipt = await pc.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
      onReplaced: (r) => {
        if (r.reason !== "cancelled") finalHash = r.transaction.hash;
      },
    });
    if (receipt.status !== "success") throw new Error(`${label} reverted on-chain. Your funds were not spent except for gas.`);
    return receipt.transactionHash ?? finalHash;
  }

  async function ensureAllowance(pc: PublicClient, erc20: Address, spender: Address, amountNeeded: bigint, sym: string) {
    const current = await pc.readContract({ address: erc20, abi: erc20Abi, functionName: "allowance", args: [address!, spender] });
    if (current >= amountNeeded) return;
    setStatus({ tone: "info", text: `Approve ${sym} in your wallet…` });
    await pc.simulateContract({ account: address!, address: erc20, abi: erc20Abi, functionName: "approve", args: [spender, amountNeeded] });
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amountNeeded] });
    await sendTx(pc, erc20, data, 0n, "Approval");
  }

  /** Graduated sells pull tokens through Permit2: ERC-20 approve to Permit2, then a Permit2 allowance for the router. */
  async function ensurePermit2(pc: PublicClient, erc20: Address, amountNeeded: bigint, sym: string) {
    await ensureAllowance(pc, erc20, PERMIT2, amountNeeded, sym);
    const [amt, expiration] = await pc.readContract({ address: PERMIT2, abi: permit2Abi, functionName: "allowance", args: [address!, erc20, UNIVERSAL_ROUTER] });
    const now = Math.floor(Date.now() / 1000);
    if (amt >= amountNeeded && Number(expiration) > now + 60) return;
    setStatus({ tone: "info", text: `Allow the swap router to move ${sym} in your wallet…` });
    const data = encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [erc20, UNIVERSAL_ROUTER, amountNeeded, now + PERMIT2_TTL_SECONDS] });
    await sendTx(pc, PERMIT2, data, 0n, "Router approval");
  }

  async function refreshAfterTrade() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["market-chain", token] }),
      qc.invalidateQueries({ queryKey: ["activity"] }),
      ethBal.refetch(),
      tokenBal.refetch(),
      native ? Promise.resolve() : quoteBal.refetch(),
    ]);
  }

  async function submit() {
    if (!client || !address || !parsed.value || minOut === null || !route || !chain) return;
    if (route.kind !== "curve" && route.kind !== "dex") return;
    const pc = client;
    const amountIn = parsed.value;
    setBusy(true);
    setStatus({ tone: "info", text: "Refreshing quote…" });
    try {
      // Always re-read state and re-quote right before sending; never trust a stale number.
      const lens = await readLensState(pc, token);
      const fresh: MarketChainState = { ...chain, lens };
      const q = await priceTrade(pc, fresh, amountIn, slippageBps);
      if (q.min === 0n) throw new Error("Amount is too small to receive anything at the current price.");

      let to: Address;
      let data: Hex;
      let value = 0n;
      setStatus({ tone: "info", text: "Simulating trade…" });
      if (route.kind === "curve") {
        const curve = route.curve as Address;
        to = curve;
        if (side === "buy") {
          if (!native) await ensureAllowance(pc, quote.address, curve, amountIn, quote.symbol);
          value = native ? amountIn : 0n;
          await pc.simulateContract({ account: address, address: curve, abi: ponsCurveAbi, functionName: "buy", args: [amountIn, q.min, address], value });
          data = encodeFunctionData({ abi: ponsCurveAbi, functionName: "buy", args: [amountIn, q.min, address] });
        } else {
          await ensureAllowance(pc, token, curve, amountIn, symbol);
          await pc.simulateContract({ account: address, address: curve, abi: ponsCurveAbi, functionName: "sell", args: [amountIn, q.min, address] });
          data = encodeFunctionData({ abi: ponsCurveAbi, functionName: "sell", args: [amountIn, q.min, address] });
        }
      } else {
        const verified = await verifyDexPool(pc, token);
        if (!verified || verified.poolId.toLowerCase() !== route.pool.toLowerCase()) throw new Error("The liquidity pool could not be verified on-chain. Refresh and retry.");
        const key: PoolKey = verified.key;
        const currencyIn = side === "buy" ? quote.address : token;
        if (currencyIn.toLowerCase() !== ZERO_ADDRESS) await ensurePermit2(pc, currencyIn, amountIn, side === "buy" ? quote.symbol : symbol);
        const call = buildV4ExactInSwap({ router: UNIVERSAL_ROUTER, key, currencyIn, amountIn, minAmountOut: q.min, deadline: deadlineFromNow() });
        to = call.to;
        data = call.data;
        value = call.value;
        await pc.call({ account: address, to, data, value });
      }

      setStatus({ tone: "info", text: "Confirm the trade in your wallet…" });
      const hash = await sendTx(pc, to, data, value, "Trade");
      setStatus({ tone: "success", text: `${side === "buy" ? "Bought" : "Sold"} successfully.`, hash });
      setAmount("");
      await refreshAfterTrade();
    } catch (err) {
      const msg =
        (err as { name?: string })?.name === "TransactionReplacementError" ? "The transaction was cancelled or replaced in your wallet."
        : err instanceof Error && !("walk" in err) ? err.message
        : decodeError(err, "Trade").message;
      setStatus({ tone: "error", text: msg });
    } finally {
      setBusy(false);
    }
  }

  /** Graduation is permissionless on Pons: sweep the full curve, then seed the Uniswap v4 pool. */
  async function completeGraduation() {
    if (!client || !address || !chain) return;
    const pc = client;
    setBusy(true);
    try {
      let lens = await readLensState(pc, token);
      if (lens.ponsPhase === GraduationPhase.NotGraduated) {
        if (!lens.readyToGraduate) throw new Error("The bonding curve is not full yet.");
        setStatus({ tone: "info", text: "Step 1/2 — confirm graduation in your wallet…" });
        await pc.simulateContract({ account: address, address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "graduate", args: [token] });
        await sendTx(pc, PONS_FACTORY, encodeFunctionData({ abi: ponsFactoryAbi, functionName: "graduate", args: [token] }), 0n, "Graduation");
        lens = await readLensState(pc, token);
      }
      if (lens.ponsPhase === GraduationPhase.Swept) {
        setStatus({ tone: "info", text: "Step 2/2 — confirm pool creation in your wallet…" });
        await pc.simulateContract({ account: address, address: PONS_FACTORY, abi: ponsFactoryAbi, functionName: "createGraduatedPool", args: [token] });
        const hash = await sendTx(pc, PONS_FACTORY, encodeFunctionData({ abi: ponsFactoryAbi, functionName: "createGraduatedPool", args: [token] }), 0n, "Pool creation");
        setStatus({ tone: "success", text: "Market graduated to Uniswap v4.", hash });
      } else {
        setStatus({ tone: "success", text: "Market graduated to Uniswap v4." });
      }
      await refreshAfterTrade();
    } catch (err) {
      const msg = err instanceof Error && !("walk" in err) ? err.message : decodeError(err, "Graduation").message;
      setStatus({ tone: "error", text: msg });
    } finally {
      setBusy(false);
    }
  }

  const maxButton = inBalance !== undefined && inBalance > 0n ? (
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAmount(formatAmount(side === "buy" && native ? (inBalance * 98n) / 100n : inBalance, inDecimals, inDecimals).replace(/,/g, ""))}>
      Max
    </button>
  ) : null;

  const tradable = route?.kind === "curve" || route?.kind === "dex";

  return (
    <div className="card stack" data-testid="trade-panel">
      <div className="row between">
        <div className="panel-title" style={{ margin: 0 }}>Trade</div>
        {route ? (
          <span className={`badge ${route.kind === "curve" ? "badge-yellow" : route.kind === "dex" ? "badge-green" : "badge-red"}`}>
            {route.kind === "curve" ? "Bonding curve" : route.kind === "dex" ? "Uniswap v4" : route.kind === "graduate" ? "Graduating" : "Unavailable"}
          </span>
        ) : null}
      </div>
      <div className="seg" role="group" aria-label="Side" style={{ width: "100%" }}>
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} type="button" style={{ flex: 1 }} aria-pressed={side === s} onClick={() => { setSide(s); setAmount(""); setStatus(null); }}>
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {chainError ? <Notice tone="error" title="RPC unavailable">{chainError}</Notice> : null}
      {route?.kind === "unavailable" ? <Notice tone="warn">{route.reason}</Notice> : null}
      {route?.kind === "graduate" ? (
        <Notice tone="info" title="Ready to graduate">
          {route.reason}
          {isConnected && onChain ? (
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={completeGraduation}>
                {busy ? <span className="spinner" aria-hidden /> : null} Complete graduation
              </button>
            </div>
          ) : null}
        </Notice>
      ) : null}

      <div className="field">
        <div className="row between">
          <label className="label" htmlFor="amt">{side === "buy" ? `Pay (${inSymbol})` : `Sell (${inSymbol})`}</label>
          <span className="tiny muted">
            Balance: {inBalance !== undefined ? formatAmount(inBalance, inDecimals, 6) : "—"} {maxButton}
          </span>
        </div>
        <div className="input-group">
          <input id="amt" className="input" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="addon">{inSymbol}</span>
        </div>
        {parsed.error ? <span className="error-text">{parsed.error}</span> : null}
        {insufficient ? <span className="error-text">Insufficient {inSymbol} balance.</span> : null}
      </div>

      <div className="field">
        <span className="label">Slippage</span>
        <div className="row" style={{ gap: 6 }}>
          <div className="seg" role="group" aria-label="Slippage">
            {SLIPPAGE_PRESETS.map((b) => (
              <button key={b} type="button" aria-pressed={slippageBps === b && !customSlip} onClick={() => { setSlippageBps(b); setCustomSlip(""); }}>{b / 100}%</button>
            ))}
          </div>
          <input
            className="input"
            style={{ width: 90 }}
            placeholder="custom %"
            aria-label="Custom slippage percent"
            value={customSlip}
            onChange={(e) => {
              setCustomSlip(e.target.value);
              try { setSlippageBps(slippagePercentToBps(e.target.value)); } catch { /* keep previous until valid */ }
            }}
          />
        </div>
        {slippageBps > 1000 ? <span className="error-text">High slippage: you may receive much less than quoted.</span> : null}
      </div>

      <dl className="kv" aria-live="polite">
        <dt>You receive (est.)</dt>
        <dd>{quoteQuery.isFetching && out === null ? "…" : out !== null ? `${formatAmount(out, outDecimals, 6)} ${outSymbol}` : "—"}</dd>
        <dt>Minimum received</dt>
        <dd>{minOut !== null ? `${formatAmount(minOut, outDecimals, 6)} ${outSymbol}` : "—"}</dd>
        <dt>Price impact</dt>
        <dd className={impact !== null && impact > 500 ? "neg" : undefined}>{impact !== null ? `${(impact / 100).toFixed(2)}%` : "—"}</dd>
        <dt>Fees</dt>
        <dd>
          {route?.kind === "dex" ? "Pool fee included in quote" : curveFeeBps !== null ? `${Number(curveFeeBps) / 100}% curve fee` : "—"}
          {route?.kind === "curve" && creatorFeeBps > 0n ? ` + ${Number(creatorFeeBps) / 100}% creator fee` : ""}
          {route?.kind === "curve" && curveFeeBps !== null && parsed.value && side === "buy" ? ` (≈ ${formatAmount(bpsOf(quoteQuery.data?.spent ?? parsed.value, curveFeeBps + creatorFeeBps), quote.decimals, 6)} ${quote.symbol})` : ""}
        </dd>
      </dl>
      {quoteQuery.data && quoteQuery.data.snipeBps > 0n && side === "buy" ? (
        <Notice tone="warn">Launch anti-snipe tax is active for a few more seconds ({Number(quoteQuery.data.snipeBps) / 100}%). Wait a moment for a better price.</Notice>
      ) : null}
      {quoteQuery.data?.spent !== null && quoteQuery.data?.spent !== undefined && parsed.value && quoteQuery.data.spent < parsed.value ? (
        <Notice tone="info">This buy fills the curve: only {formatAmount(quoteQuery.data.spent, quote.decimals, 6)} {quote.symbol} is charged, the rest is refunded.</Notice>
      ) : null}
      {quoteQuery.isError ? <Notice tone="error">Quote failed: {quoteQuery.error instanceof Error && !("walk" in quoteQuery.error) ? quoteQuery.error.message : decodeError(quoteQuery.error, "Quote").message}</Notice> : null}

      {!isConnected ? (
        <ConnectButton block />
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={busy || !onChain || !parsed.value || insufficient || minOut === null || !tradable}
          onClick={submit}
          data-testid="trade-submit"
        >
          {busy ? <span className="spinner" aria-hidden /> : null}
          {!onChain ? `Switch to ${CHAIN_NAME}` : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
        </button>
      )}
      {status ? (
        <Notice tone={status.tone}>
          {status.text}
          {status.hash ? (
            <> <a href={explorerTx(status.hash)} target="_blank" rel="noopener noreferrer" className="mono small">View tx ↗</a></>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}
