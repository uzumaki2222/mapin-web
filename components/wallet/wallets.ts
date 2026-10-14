// Well-known wallets. Detection itself is done by EIP-6963 announcements and window.ethereum
// flags — these names are only used for labels and install links.
export const KNOWN_WALLETS = [
  { key: "metamask", name: "MetaMask", match: /metamask/i, installUrl: "https://metamask.io/download/" },
  { key: "rabby", name: "Rabby", match: /rabby/i, installUrl: "https://rabby.io/" },
  { key: "okx", name: "OKX Wallet", match: /okx/i, installUrl: "https://web3.okx.com/download" },
  { key: "robinhood", name: "Robinhood Wallet", match: /robinhood/i, installUrl: "https://robinhood.com/us/en/web3-wallet/" },
] as const;

export interface LegacyFlags {
  isMetaMask?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isBinance?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isTokenPocket?: boolean;
  isCoinbaseWallet?: boolean;
}

/** Name of the wallet behind window.ethereum. Order matters: several wallets also set isMetaMask. */
export function legacyWalletName(p: LegacyFlags): string {
  if (p.isRabby) return "Rabby";
  if (p.isOkxWallet || p.isOKExWallet) return "OKX Wallet";
  if (p.isBinance) return "Binance Wallet";
  if (p.isTrust || p.isTrustWallet) return "Trust Wallet";
  if (p.isTokenPocket) return "TokenPocket";
  if (p.isCoinbaseWallet) return "Coinbase Wallet";
  if (p.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

/** Deep links that open the current page inside a mobile wallet's built-in browser. */
export function mobileDeepLinks(href: string): { name: string; url: string }[] {
  const noProtocol = href.replace(/^https?:\/\//, "");
  return [
    { name: "MetaMask", url: `https://metamask.app.link/dapp/${noProtocol}` },
    { name: "OKX Wallet", url: `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(href)}` },
    { name: "Trust Wallet", url: `https://link.trustwallet.com/open_url?coin_id=20000714&url=${encodeURIComponent(href)}` },
  ];
}
