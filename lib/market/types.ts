// Shared API data shapes (client + server). Bigints travel as decimal strings.

export type MarketStatus = "bonding" | "graduated";

/** A real-world place on the map (tokenized or not). */
export interface Business {
  id: string;
  source: "osm" | "user";
  sourceId: string;
  slug: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  website: string | null;
  lat: number;
  lng: number;
  claimed: boolean;
  hidden: boolean;
  /** set when the business already has a market */
  market: { symbol: string; tokenAddress: string; imageUrl: string | null } | null;
}

/** Lightweight pin for the map layer of tokenized businesses. */
export interface MapPin {
  slug: string;
  name: string;
  symbol: string;
  category: string | null;
  lat: number;
  lng: number;
  imageUrl: string | null;
  claimed: boolean;
  volume24h: string;
  quoteSymbol: string;
  quoteDecimals: number;
}

export interface MarketSummary {
  id: string;
  slug: string;
  businessName: string;
  category: string | null;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  claimed: boolean;
  projectName: string;
  tokenName: string;
  symbol: string;
  tokenAddress: string;
  creatorWallet: string;
  quoteToken: string;
  quoteSymbol: string;
  quoteDecimals: number;
  status: MarketStatus;
  priceWad: string | null;
  marketCapWad: string | null;
  progressWad: string | null;
  volume24h: string; // raw quote units
  trades24h: number;
  holders: number | null;
  imageUrl: string | null;
  launchTx: string;
  createdAt: string;
  statsUpdatedAt: string | null;
}

export interface MarketDetail extends MarketSummary {
  businessId: string;
  source: "osm" | "user";
  sourceId: string;
  address: string | null;
  website: string | null;
  hidden: boolean;
  claimedWallet: string | null;
  feeRecipient: string;
  description: string | null;
  metaCid: string;
  buyTaxBps: number;
  sellTaxBps: number;
  tokenVersion: number;
  launchBlock: string;
  poolAddress: string | null;
  totalSupplyRaw: string | null;
  volumeAll: string;
}

export interface ActivityItem {
  type: "launch" | "buy" | "sell" | "graduate";
  venue: "curve" | "dex";
  wallet: string | null;
  txHash: string;
  amountIn: string | null;
  amountOut: string | null;
  quoteVolume: string | null;
  timestamp: string;
}

export interface SessionInfo {
  configured: { database: boolean; sessions: boolean; admin: boolean; escrow: boolean; metadata: boolean; indexer: boolean };
  wallet: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** A launch, buy or sell on any market, for the global live feed. */
export interface RecentTrade {
  type: "launch" | "buy" | "sell";
  venue: "curve" | "dex";
  wallet: string | null;
  txHash: string;
  tokenAmount: string | null; // raw, 18 decimals
  quoteVolume: string | null; // raw quote units
  timestamp: string;
  slug: string;
  businessName: string;
  city: string | null;
  symbol: string;
  imageUrl: string | null;
  quoteSymbol: string;
  quoteDecimals: number;
}

/** A place found by search or by clicking the map (not yet stored). */
export interface PlaceCandidate {
  source: "osm";
  sourceId: string; // node/123 | way/456 | relation/789
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  website: string | null;
  lat: number;
  lng: number;
}

export interface SearchResult {
  label: string;
  sublabel: string;
  lat: number;
  lng: number;
  /** bounding box [west, south, east, north] when the result is an area (city, country) */
  bbox: [number, number, number, number] | null;
  /** set when the result is a business/POI */
  place: PlaceCandidate | null;
}

export interface ClaimInfo {
  id: string;
  domain: string;
  domainMatches: boolean;
  txtName: string;
  txtValue: string;
  status: "pending" | "dns_verified" | "approved" | "rejected";
}
