import { decodeEventLog, getAddress, type Address, type Log, type TransactionReceipt } from "viem";
import { ponsCurveAbi, ponsFactoryAbi } from "@/lib/contracts/pons-abi";
import { PONS_FACTORY } from "@/lib/contracts/constants";

export interface TokenLaunchedEvent {
  token: Address;
  curve: Address;
  deployer: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  logIndex: number;
}

/** Extract the Pons factory's TokenLaunched event from a launch transaction receipt. */
export function parseTokenLaunched(receipt: Pick<TransactionReceipt, "logs" | "status">): TokenLaunchedEvent | null {
  if (receipt.status !== "success") return null;
  for (const log of receipt.logs as Log[]) {
    if (log.address.toLowerCase() !== PONS_FACTORY.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: ponsFactoryAbi, data: log.data, topics: log.topics, eventName: "TokenLaunched" });
      return {
        token: getAddress(ev.args.token),
        curve: getAddress(ev.args.curve),
        deployer: getAddress(ev.args.deployer),
        pairToken: getAddress(ev.args.pairToken),
        graduationThreshold: ev.args.graduationThreshold,
        logIndex: log.logIndex ?? 0,
      };
    } catch {
      // other factory events in the same receipt
    }
  }
  return null;
}

export interface CurveTradeEvent {
  side: "buy" | "sell";
  /** buy: quote spent, sell: tokens in */
  amountIn: bigint;
  /** buy: tokens out, sell: quote out */
  amountOut: bigint;
  quoteVolume: bigint;
  fee: bigint;
  /** trade recipient (the wallet that ends up with the output) */
  wallet: Address;
  logIndex: number;
}

/** Decode a CurveBuy / CurveSell log emitted by `curve`. Returns null for any other log. */
export function decodeCurveTrade(log: Log, curve: string): CurveTradeEvent | null {
  if (log.address.toLowerCase() !== curve.toLowerCase()) return null;
  try {
    const ev = decodeEventLog({ abi: ponsCurveAbi, data: log.data, topics: log.topics });
    if (ev.eventName === "CurveBuy") {
      const a = ev.args;
      return { side: "buy", amountIn: a.quoteIn, amountOut: a.tokensOut, quoteVolume: a.quoteIn, fee: a.fee + a.tax, wallet: getAddress(a.recipient), logIndex: log.logIndex ?? 0 };
    }
    if (ev.eventName === "CurveSell") {
      const a = ev.args;
      return { side: "sell", amountIn: a.tokensIn, amountOut: a.quoteOut, quoteVolume: a.quoteOut, fee: a.fee + a.tax, wallet: getAddress(a.seller), logIndex: log.logIndex ?? 0 };
    }
  } catch {
    /* not a curve trade event */
  }
  return null;
}
