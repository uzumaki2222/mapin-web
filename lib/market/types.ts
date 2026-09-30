// Shared API data shapes (client + server). Bigints travel as decimal strings.

export type MarketStatus = "bonding" | "graduated";

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

/** An area on the map: country, state, city, town, village, neighbourhood … (tokenized or not). */
export interface Place {
  id: string;
  sourceId: string; // OpenStreetMap element, e.g. relation/175905
  slug: string;
  name: string;
  placeType: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  bbox: BBox | null;
  hidden: boolean;
  /** set when the place already has a market */
  market: { symbol: string; tokenAddress: string; imageUrl: string | null } | null;
}

/** Lightweight pin for the map layer of tokenized places. */
export interface MapPin {
  slug: string;
  name: string;
  symbol: string;
  placeType: string | null;
  lat: number;
  lng: number;
  imageUrl: string | null;
  volume24h: string;
  quoteSymbol: string;
  quoteDecimals: number;
}

export interface MarketSummary {
  id: string;
  slug: string;
  placeName: string;
  placeType: string | null;
  region: string | null;
  country: string | null;
  lat: number;
  lng: number;
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
  placeId: string;
  sourceId: string;
  bbox: BBox | null;
  hidden: boolean;
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
  configured: { database: boolean; sessions: boolean; admin: boolean; metadata: boolean; indexer: boolean };
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
  placeName: string;
  region: string | null;
  symbol: string;
  imageUrl: string | null;
  quoteSymbol: string;
  quoteDecimals: number;
}

/** A place found by search or on the map (not yet stored). */
export interface PlaceCandidate {
  sourceId: string; // node/123 | way/456 | relation/789
  name: string;
  placeType: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  bbox: BBox | null;
}

export interface SearchResult {
  label: string;
  sublabel: string;
  lat: number;
  lng: number;
  bbox: BBox | null;
  place: PlaceCandidate | null;
}

/** Zoom level of the area picked at a map point (Nominatim reverse "zoom"). */
export type AreaLevel = "country" | "state" | "county" | "city" | "town" | "suburb" | "neighbourhood";
