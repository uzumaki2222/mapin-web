import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// JSON-RPC relay to Robinhood Chain for browsers and the Privy embedded wallet: the public RPC does
// not answer requests made directly from web pages. Only read / estimation methods and the broadcast
// of an ALREADY-SIGNED transaction (eth_sendRawTransaction) are forwarded — the relay never holds keys
// and cannot sign anything.
const ALLOWED = new Set([
  "eth_chainId", "net_version", "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice",
  "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getBalance", "eth_getCode", "eth_getTransactionCount",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getStorageAt", "eth_sendRawTransaction", "eth_syncing", "web3_clientVersion",
]);

// Privy's embedded wallet runs on its own origin, so the relay answers cross-origin requests.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// Small per-instance limiter (the database is not touched on this hot path).
const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    if (hits.size > 5_000) hits.clear();
    return false;
  }
  h.n++;
  return h.n > 600;
}

type RpcReq = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32005, message: "rate limited" } }, { status: 429, headers: CORS });
  let body: RpcReq | RpcReq[];
  try {
    body = (await req.json()) as RpcReq | RpcReq[];
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400, headers: CORS });
  }
  const list = Array.isArray(body) ? body : [body];
  if (list.length === 0 || list.length > 50) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } }, { status: 400, headers: CORS });
  }
  const upstream = serverEnv().ROBINHOOD_RPC_URL;
  // Forward one by one: the upstream may not accept JSON-RPC batches.
  const out = await Promise.all(
    list.map(async (r) => {
      if (typeof r?.method !== "string" || !ALLOWED.has(r.method)) {
        return { jsonrpc: "2.0", id: r?.id ?? null, error: { code: -32601, message: "method not allowed" } };
      }
      try {
        const res = await fetch(upstream, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: r.id ?? 1, method: r.method, params: r.params ?? [] }),
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        });
        return await res.json();
      } catch (err) {
        return { jsonrpc: "2.0", id: r.id ?? null, error: { code: -32603, message: `upstream unavailable: ${String(err).slice(0, 120)}` } };
      }
    }),
  );
  return NextResponse.json(Array.isArray(body) ? out : out[0], { headers: { ...CORS, "Cache-Control": "no-store" } });
}
