// Public (browser-safe) configuration. Only NEXT_PUBLIC_* values may appear here, and they must
// be referenced literally so Next.js can inline them at build time.

export const PUBLIC_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");

/** Official BNB Chain public endpoint (docs.bnbchain.org) is the fallback. */
export const PUBLIC_BSC_RPC_URL = process.env.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";

export const BSC_EXPLORER_URL = "https://bscscan.com";

export const explorerTx = (hash: string) => `${BSC_EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${BSC_EXPLORER_URL}/address/${addr}`;
export const explorerToken = (addr: string) => `${BSC_EXPLORER_URL}/token/${addr}`;

export const SITE_NAME = "mapin";
