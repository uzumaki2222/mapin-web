// Public (browser-safe) configuration. Only NEXT_PUBLIC_* values may appear here, and they must
// be referenced literally so Next.js can inline them at build time.

export const PUBLIC_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");

/** Official Robinhood Chain public endpoint is the fallback. */
export const PUBLIC_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

/** This site's JSON-RPC relay (app/api/rpc) — used by the browser and the Privy embedded wallet. */
export const RPC_RELAY_URL = `${PUBLIC_APP_URL}/api/rpc`;

export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";
export const EXPLORER_NAME = "Blockscout";

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
export const explorerToken = (addr: string) => `${EXPLORER_URL}/token/${addr}`;

/**
 * Wallet that receives the owner's share of every trade until the real owner claims the business
 * (the Pons creatorFeeRecipient of every mapin token). Keep its key offline; see README → Owner escrow.
 */
export const OWNER_ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_OWNER_ESCROW_ADDRESS || "").toLowerCase();

/** Share of every curve trade held for the business owner, in basis points (70 = 0.7 %). */
export const OWNER_FEE_BPS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_OWNER_FEE_BPS || "70");
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : 70;
})();

export const SITE_NAME = "mapin";
