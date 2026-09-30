import { decodeEventLog, getAddress, type Address, type Log, type TransactionReceipt } from "viem";
import { portalAbi } from "@/lib/contracts/portal-abi";
import { PORTAL_ADDRESS } from "@/lib/contracts/constants";

export interface TokenCreatedEvent {
  token: Address;
  creator: Address;
  name: string;
  symbol: string;
  meta: string;
  nonce: bigint;
  timestamp: bigint;
  logIndex: number;
}

/** Extract the TokenCreated event emitted by the Portal in a launch transaction receipt. */
export function parseTokenCreated(receipt: Pick<TransactionReceipt, "logs" | "status">): TokenCreatedEvent | null {
  if (receipt.status !== "success") return null;
  for (const log of receipt.logs as Log[]) {
    if (log.address.toLowerCase() !== PORTAL_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: portalAbi, data: log.data, topics: log.topics, eventName: "TokenCreated" });
      return {
        token: getAddress(ev.args.token),
        creator: getAddress(ev.args.creator),
        name: ev.args.name,
        symbol: ev.args.symbol,
        meta: ev.args.meta,
        nonce: ev.args.nonce,
        timestamp: ev.args.ts,
        logIndex: log.logIndex ?? 0,
      };
    } catch {
      // other Portal events in the same receipt
    }
  }
  return null;
}
