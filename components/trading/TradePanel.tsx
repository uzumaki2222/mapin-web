"use client";

import { useEffect, useMemo, useState } from "react";
import { useConfig, useConnection, useBalance, usePublicClient, useReadContract } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useWallets } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createWalletClient, custom, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { bscChain } from "@/lib/chain/bsc";
import { portalAbi } from "@/lib/contracts/portal-abi";
import { erc20Abi } from "@/lib/contracts/erc20-abi";
import { pancakeV2RouterAbi } from "@/lib/contracts/pancake-abi";
import { BSC_CHAIN_ID, PANCAKE_V2_ROUTER, PORTAL_ADDRESS, ZERO_ADDRESS } from "@/lib/contracts/constants";
import { quoteCurve, quoteDex, readProtocolFeeRate } from "@/lib/market/onchain";
import { applySlippage, bpsOf, deadlineFromNow, DEFAULT_SLIPPAGE_BPS, priceImpactBps, spotPriceFromReservesWad, slippagePercentToBps } from "@/lib/market/math";
import { formatAmount, parseAmount, ValidationError } from "@/lib/validation/normalize";
import { decodeError } from "@/lib/errors/decode";
import { explorerTx } from "@/lib/config/public";
import { Notice } from "@/components/ui/Notice";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import type { MarketChainState } from "@/hooks/useMarketChain";

type Side = "buy" | "sell";
type Signer = Awaited<ReturnType<typeof getWalletClient>>;
const MAX_GAS = 15_000_000n;
const clampGas = (g: bigint) => ((g * 12n) / 10n > MAX_GAS ? MAX_GAS : (g * 12n) / 10n);
const SLIPPAGE_PRESETS = [50, 100, 300, 500];
const TOKEN_DECIMALS = 18; // re-read on-chain below; this is only the parse fallback while loading

interface Props {
  token: Address;
  symbol: string;
  quote: { address: Address; symbol: string; decimals: number };
  chain: MarketChainState | undefined;
  chainError: string | null;
}

export function TradePanel({ token, symbol, quote, chain, chainError }: Props) {
  const { address, isConnected, chainId } = useConnection();
  // Use the SAME wagmi config instance the provider uses (the imported one can be a different, unconnected copy).
  const config = useConfig();
  const { wallets } = useWallets();
  const client = usePublicClient({ chainId: BSC_CHAIN_ID }) as unknown as PublicClient | undefined;
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
      return await getWalletClient(config, { chainId: BSC_CHAIN_ID });
    } catch {
      const w = wallets.find((x) => address && x.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
      if (!w) throw new Error("Wallet disconnected. Reconnect your wallet and try again.");
      try {
        await w.switchChain(BSC_CHAIN_ID);
      } catch {
        /* wallet may already be on BSC or not support switching; the tx still targets bscChain */
      }
      const provider = await w.getEthereumProvider();
      return createWalletClient({ account: w.address as Address, chain: bscChain, transport: custom(provider) }) as unknown as Signer;
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDebounced(amount.trim()), 350);
    return () => clearTimeout(t);
  }, [amount]);

  const native = quote.address.toLowerCase() === ZERO_ADDRESS;
  const route = chain?.route;
  const onBsc = chainId === BSC_CHAIN_ID;

  const tokenDecimals = useReadContract({ address: token, abi: erc20Abi, functionName: "decimals", chainId: BSC_CHAIN_ID });
  const tDec = tokenDecimals.data !== undefined ? Number(tokenDecimals.data) : TOKEN_DECIMALS;
  const bnbBal = useBalance({ address, chainId: BSC_CHAIN_ID, query: { enabled: Boolean(address) } });
  const quoteBal = useReadContract({
    address: quote.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: BSC_CHAIN_ID,
    query: { enabled: Boolean(address) && !native },
  });
  const tokenBal = useReadContract({
    address: token, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: BSC_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });
  const fees = useQuery({ queryKey: ["protocol-fee"], enabled: Boolean(client), queryFn: () => readProtocolFeeRate(client!), staleTime: 300_000 });

  const inDecimals = side === "buy" ? quote.decimals : tDec;
  const outDecimals = side === "buy" ? tDec : quote.decimals;
  const inSymbol = side === "buy" ? quote.symbol : symbol;
  const outSymbol = side === "buy" ? symbol : quote.symbol;
  const inBalance: bigint | undefined = side === "buy" ? (native ? bnbBal.data?.value : quoteBal.data) : tokenBal.data;

  const parsed = useMemo(() => {
    if (!debounced) return { value: null as bigint | null, error: null as string | null };
    try {
      const v = parseAmount(debounced, inDecimals);
      return { value: v > 0n ? v : null, error: v > 0n ? null : "Enter an amount above 0" };
    } catch (err) {
      return { value: null, error: err instanceof ValidationError ? err.message : "Invalid amount" };
    }
  }, [debounced, inDecimals]);

  const quoteQuery = useQuery({
    queryKey: ["trade-quote", token, side, parsed.value?.toString(), route?.kind, chain?.lens.status],
    enabled: Boolean(client && parsed.value && route && route.kind !== "unavailable"),
    refetchInterval: 10_000,
    queryFn: async () => {
      const pc = client!;
      const amountIn = parsed.value!;
      if (route!.kind === "curve") {
        const out = await quoteCurve(pc, {
          inputToken: side === "buy" ? quote.address : token,
          outputToken: side === "buy" ? token : quote.address,
          inputAmount: amountIn,
        });
        return { out, spot: chain!.lens.price };
      }
      const pool = chain!.pool!;
      const out = await quoteDex(pc, {
        side, token, pairQuote: pool.pairQuote, amountIn, buyTaxBps: chain!.lens.buyTaxRate, sellTaxBps: chain!.lens.sellTaxRate,
      });
      return { out, spot: spotPriceFromReservesWad(pool.reserveToken, pool.reserveQuote, tDec, quote.decimals) };
    },
  });

  const out = quoteQuery.data?.out ?? null;
  const minOut = out !== null && out > 0n ? applySlippage(out, slippageBps) : null;
  const impact =
    out !== null && parsed.value && quoteQuery.data
      ? priceImpactBps({ side, spotPriceWad: quoteQuery.data.spot, amountIn: parsed.value, amountOut: out, quoteDecimals: quote.decimals, tokenDecimals: tDec })
      : null;
  const taxBps = chain ? (side === "buy" ? chain.lens.buyTaxRate : chain.lens.sellTaxRate) : 0n;
  const protoBps = route?.kind === "curve" ? (side === "buy" ? fees.data?.buyBps : fees.data?.sellBps) ?? null : null;
  const insufficient = parsed.value !== null && inBalance !== undefined && parsed.value > inBalance;

  async function ensureAllowance(pc: PublicClient, erc20: Address, spender: Address, amountNeeded: bigint, sym: string) {
    const current = await pc.readContract({ address: erc20, abi: erc20Abi, functionName: "allowance", args: [address!, spender] });
    if (current >= amountNeeded) return;
    setStatus({ tone: "info", text: `Approve ${sym} in your wallet…` });
    await pc.simulateContract({ account: address!, address: erc20, abi: erc20Abi, functionName: "approve", args: [spender, amountNeeded] });
    const wc = await getSigner();
    let hash: Hex;
    try {
      hash = await wc.writeContract({ address: erc20, abi: erc20Abi, functionName: "approve", args: [spender, amountNeeded], account: address!, chain: bscChain });
    } catch (err) {
      const d = decodeError(err, "Approval");
      throw new Error(d.kind === "rejected" ? "Approval rejected in your wallet." : d.message);
    }
    setStatus({ tone: "info", text: "Confirming approval…", hash });
    const r = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (r.status !== "success") throw new Error("Approval transaction reverted.");
  }

  async function submit() {
    if (!client || !address || !parsed.value || minOut === null || !route || route.kind === "unavailable" || !chain) return;
    const pc = client;
    const amountIn = parsed.value;
    setBusy(true);
    setStatus({ tone: "info", text: "Refreshing quote…" });
    try {
      // Always re-quote right before sending; never trust a stale number.
      let fresh: bigint;
      if (route.kind === "curve") {
        fresh = await quoteCurve(pc, { inputToken: side === "buy" ? quote.address : token, outputToken: side === "buy" ? token : quote.address, inputAmount: amountIn });
      } else {
        fresh = await quoteDex(pc, { side, token, pairQuote: chain.pool!.pairQuote, amountIn, buyTaxBps: chain.lens.buyTaxRate, sellTaxBps: chain.lens.sellTaxRate });
      }
      const min = applySlippage(fresh, slippageBps);
      if (min === 0n) throw new Error("Amount is too small to receive anything at the current price.");

      let to: Address;
      let data: Hex;
      let value = 0n;
      setStatus({ tone: "info", text: "Simulating trade…" });
      if (route.kind === "curve") {
        const inputToken = side === "buy" ? quote.address : token;
        const outputToken = side === "buy" ? token : quote.address;
        if (inputToken !== ZERO_ADDRESS) await ensureAllowance(pc, inputToken, PORTAL_ADDRESS, amountIn, side === "buy" ? quote.symbol : symbol);
        value = inputToken === ZERO_ADDRESS ? amountIn : 0n;
        const params = { inputToken, outputToken, inputAmount: amountIn, minOutputAmount: min, permitData: "0x" as Hex };
        await pc.simulateContract({ account: address, address: PORTAL_ADDRESS, abi: portalAbi, functionName: "swapExactInput", args: [params], value });
        to = PORTAL_ADDRESS;
        data = encodeFunctionData({ abi: portalAbi, functionName: "swapExactInput", args: [params] });
      } else {
        const pairQuote = chain.pool!.pairQuote;
        const deadline = deadlineFromNow();
        to = PANCAKE_V2_ROUTER;
        if (side === "buy" && native) {
          const args = [min, [pairQuote, token], address, deadline] as const;
          value = amountIn;
          await pc.simulateContract({ account: address, address: to, abi: pancakeV2RouterAbi, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args, value });
          data = encodeFunctionData({ abi: pancakeV2RouterAbi, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args });
        } else if (side === "sell" && native) {
          await ensureAllowance(pc, token, to, amountIn, symbol);
          const args = [amountIn, min, [token, pairQuote], address, deadline] as const;
          await pc.simulateContract({ account: address, address: to, abi: pancakeV2RouterAbi, functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens", args });
          data = encodeFunctionData({ abi: pancakeV2RouterAbi, functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens", args });
        } else {
          const inTok = side === "buy" ? pairQuote : token;
          const outTok = side === "buy" ? token : pairQuote;
          await ensureAllowance(pc, inTok, to, amountIn, side === "buy" ? quote.symbol : symbol);
          const args = [amountIn, min, [inTok, outTok], address, deadline] as const;
          await pc.simulateContract({ account: address, address: to, abi: pancakeV2RouterAbi, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args });
          data = encodeFunctionData({ abi: pancakeV2RouterAbi, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args });
        }
      }

      const gas = clampGas(await pc.estimateGas({ account: address, to, data, value }));
      setStatus({ tone: "info", text: "Confirm the trade in your wallet…" });
      const wc = await getSigner();
      let hash: Hex;
      try {
        hash = await wc.sendTransaction({ account: address, to, data, value, gas, chain: bscChain });
      } catch (err) {
        const d = decodeError(err, "Trade");
        throw new Error(d.kind === "rejected" ? "Trade rejected in your wallet." : d.message);
      }
      setStatus({ tone: "info", text: "Transaction submitted — confirming…", hash });
      let finalHash = hash;
      const receipt = await pc.waitForTransactionReceipt({
        hash,
        timeout: 180_000,
        onReplaced: (r) => {
          if (r.reason !== "cancelled") finalHash = r.transaction.hash;
        },
      });
      if (receipt.status !== "success") throw new Error("Trade reverted on-chain. Your funds were not spent except for gas.");
      setStatus({ tone: "success", text: `${side === "buy" ? "Bought" : "Sold"} successfully.`, hash: receipt.transactionHash ?? finalHash });
      setAmount("");
      // Record the trade right away (verified from the receipt on the server) so the live feed shows it.
      await fetch("/api/trades/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: receipt.transactionHash ?? finalHash }),
      }).catch(() => undefined);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["market-chain", token] }),
        qc.invalidateQueries({ queryKey: ["activity"] }),
        qc.invalidateQueries({ queryKey: ["ticker-trades"] }),
        qc.invalidateQueries({ queryKey: ["recent-trades"] }),
        bnbBal.refetch(),
        tokenBal.refetch(),
        native ? Promise.resolve() : quoteBal.refetch(),
      ]);
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

  const maxButton = inBalance !== undefined && inBalance > 0n ? (
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAmount(formatAmount(side === "buy" && native ? (inBalance * 98n) / 100n : inBalance, inDecimals, inDecimals).replace(/,/g, ""))}>
      Max
    </button>
  ) : null;

  return (
    <div className="card stack" data-testid="trade-panel">
      <div className="row between">
        <div className="panel-title" style={{ margin: 0 }}>Trade</div>
        {route ? (
          <span className={`badge ${route.kind === "curve" ? "badge-yellow" : route.kind === "dex" ? "badge-green" : "badge-red"}`}>
            {route.kind === "curve" ? "Bonding curve" : route.kind === "dex" ? "PancakeSwap v2" : "Unavailable"}
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
          {route?.kind === "dex" ? "0.25% LP" : protoBps !== null ? `${Number(protoBps) / 100}% protocol` : "—"}
          {taxBps > 0n ? ` + ${Number(taxBps) / 100}% ${side} tax` : ""}
          {route?.kind === "curve" && protoBps !== null && parsed.value && side === "buy" ? ` (≈ ${formatAmount(bpsOf(parsed.value, protoBps), quote.decimals, 6)} ${quote.symbol})` : ""}
        </dd>
      </dl>
      {quoteQuery.isError ? <Notice tone="error">Quote failed: {decodeError(quoteQuery.error, "Quote").message}</Notice> : null}

      {!isConnected ? (
        <ConnectButton block />
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={busy || !onBsc || !parsed.value || insufficient || minOut === null || !route || route.kind === "unavailable"}
          onClick={submit}
          data-testid="trade-submit"
        >
          {busy ? <span className="spinner" aria-hidden /> : null}
          {!onBsc ? "Switch to BNB Chain" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
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
