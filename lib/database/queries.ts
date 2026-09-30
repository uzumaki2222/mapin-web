import "server-only";
import type { PoolClient } from "pg";
import { query, queryOne } from "@/lib/database/pool";
import type { ActivityItem, Business, MapPin, MarketDetail, MarketSummary, PlaceCandidate, RecentTrade } from "@/lib/market/types";
import { marketCapWad } from "@/lib/market/math";
import { dedupeKey, slugify } from "@/lib/validation/normalize";

// ------------------------------------------------------------------ users

export interface UserRow {
  id: string;
  wallet_address: string;
}

export async function upsertUserByWallet(wallet: string): Promise<UserRow> {
  const row = await queryOne<UserRow>(
    `INSERT INTO users (wallet_address) VALUES ($1)
     ON CONFLICT (wallet_address) DO UPDATE SET updated_at = now()
     RETURNING id, wallet_address`,
    [wallet.toLowerCase()],
  );
  return row!;
}

// ------------------------------------------------------------------ businesses

export interface BusinessRow {
  id: string;
  source: "osm" | "user";
  source_id: string;
  slug: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  website: string | null;
  lat: number;
  lng: number;
  claimed_wallet: string | null;
  hidden: boolean;
  market_symbol?: string | null;
  market_token?: string | null;
  market_image_cid?: string | null;
}

const BUSINESS_SELECT = `
  SELECT b.id, b.source, b.source_id, b.slug, b.name, b.category, b.address, b.city, b.country, b.country_code,
         b.website, b.lat, b.lng, b.claimed_wallet, b.hidden,
         m.symbol AS market_symbol, m.token_address AS market_token, m.image_cid AS market_image_cid
  FROM businesses b LEFT JOIN markets m ON m.business_id = b.id`;

export function toBusiness(r: BusinessRow): Business {
  return {
    id: r.id,
    source: r.source,
    sourceId: r.source_id,
    slug: r.slug,
    name: r.name,
    category: r.category,
    address: r.address,
    city: r.city,
    country: r.country,
    countryCode: r.country_code,
    website: r.website,
    lat: r.lat,
    lng: r.lng,
    claimed: Boolean(r.claimed_wallet),
    hidden: r.hidden,
    market: r.market_symbol && r.market_token
      ? { symbol: r.market_symbol, tokenAddress: r.market_token, imageUrl: r.market_image_cid ? `/api/ipfs/${r.market_image_cid}` : null }
      : null,
  };
}

export async function getBusinessById(id: string): Promise<BusinessRow | null> {
  return queryOne<BusinessRow>(`${BUSINESS_SELECT} WHERE b.id = $1`, [id]);
}

export async function getBusinessBySource(source: string, sourceId: string): Promise<BusinessRow | null> {
  return queryOne<BusinessRow>(`${BUSINESS_SELECT} WHERE b.source = $1 AND b.source_id = $2`, [source, sourceId]);
}

/** A short random suffix keeps slugs unique and unguessable-enough without a lookup loop. */
function slugSuffix(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Insert (or refresh) a business that exists in OpenStreetMap. Identity is the OSM element id; the
 * name and details are refreshed from OSM on every resolve while no market exists yet.
 */
export async function upsertOsmBusiness(p: PlaceCandidate, userId: string | null): Promise<BusinessRow> {
  await query(
    `INSERT INTO businesses (source, source_id, slug, name, category, address, city, country, country_code, website, lat, lng, added_by_user_id)
     VALUES ('osm', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (source, source_id) DO UPDATE SET
       name = CASE WHEN EXISTS (SELECT 1 FROM markets m WHERE m.business_id = businesses.id) THEN businesses.name ELSE EXCLUDED.name END,
       category = EXCLUDED.category, address = EXCLUDED.address, city = EXCLUDED.city, country = EXCLUDED.country,
       country_code = EXCLUDED.country_code, website = EXCLUDED.website, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
       updated_at = now()`,
    [p.sourceId, `${slugify(p.name)}-${slugSuffix()}`, p.name, p.category, p.address, p.city, p.country, p.countryCode,
      p.website, p.lat, p.lng, userId],
  );
  return (await getBusinessBySource("osm", p.sourceId))!;
}

export interface NewUserBusiness {
  name: string;
  category: string | null;
  address: string | null;
  website: string | null;
  lat: number;
  lng: number;
  city: string | null;
  country: string | null;
  countryCode: string | null;
}

export async function insertUserBusiness(b: NewUserBusiness, userId: string): Promise<BusinessRow> {
  const key = dedupeKey(b.name, b.lat, b.lng);
  const existing = await queryOne<BusinessRow>(`${BUSINESS_SELECT} WHERE b.dedupe_key = $1`, [key]);
  if (existing) return existing;
  const id = slugSuffix() + slugSuffix();
  await query(
    `INSERT INTO businesses (source, source_id, slug, name, category, address, city, country, country_code, website, lat, lng,
                             dedupe_key, added_by_user_id)
     VALUES ('user', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [id, `${slugify(b.name)}-${slugSuffix()}`, b.name, b.category, b.address, b.city, b.country, b.countryCode, b.website,
      b.lat, b.lng, key, userId],
  );
  return (await queryOne<BusinessRow>(`${BUSINESS_SELECT} WHERE b.dedupe_key = $1`, [key]))!;
}

/** Tokenized, visible businesses inside a bounding box (or everywhere), busiest first. */
export async function listMapPins(bbox: [number, number, number, number] | null, limit: number): Promise<MapPin[]> {
  const params: unknown[] = [limit];
  let where = `b.hidden = false`;
  if (bbox) {
    const [w, s, e, n] = bbox;
    params.push(s, n);
    where += ` AND b.lat BETWEEN $2 AND $3`;
    if (w <= e) {
      params.push(w, e);
      where += ` AND b.lng BETWEEN $4 AND $5`;
    } else {
      // box crosses the antimeridian
      params.push(w, e);
      where += ` AND (b.lng >= $4 OR b.lng <= $5)`;
    }
  }
  const rows = await query<{
    slug: string; name: string; symbol: string; category: string | null; lat: number; lng: number; image_cid: string | null;
    claimed_wallet: string | null; volume: string; quote_symbol: string; quote_decimals: number;
  }>(
    `SELECT b.slug, b.name, m.symbol, b.category, b.lat, b.lng, m.image_cid, b.claimed_wallet, m.quote_symbol, m.quote_decimals,
            COALESCE(v.volume, 0)::text AS volume
     FROM markets m JOIN businesses b ON b.id = m.business_id
     LEFT JOIN LATERAL (
       SELECT SUM(a.quote_volume) AS volume FROM activity a
       WHERE a.market_id = m.id AND a.type IN ('buy','sell') AND a."timestamp" > now() - interval '24 hours'
     ) v ON true
     WHERE ${where}
     ORDER BY COALESCE(v.volume, 0) DESC, m.created_at DESC
     LIMIT $1`,
    params,
  );
  return rows.map((r) => ({
    slug: r.slug, name: r.name, symbol: r.symbol, category: r.category, lat: r.lat, lng: r.lng,
    imageUrl: r.image_cid ? `/api/ipfs/${r.image_cid}` : null, claimed: Boolean(r.claimed_wallet),
    volume24h: r.volume, quoteSymbol: r.quote_symbol, quoteDecimals: r.quote_decimals,
  }));
}

// ------------------------------------------------------------------ launch intents

export interface LaunchIntentRow {
  id: string;
  business_id: string;
  creator_wallet: string;
  predicted_token: string | null;
  meta_cid: string;
  token_name: string;
  symbol: string;
  quote_token: string;
  config: Record<string, unknown>;
  expires_at: Date;
  consumed_at: Date | null;
}

export async function activeIntentForBusiness(businessId: string, client?: PoolClient): Promise<LaunchIntentRow | null> {
  const sql = `SELECT * FROM launch_intents WHERE business_id = $1 AND consumed_at IS NULL AND expires_at > now()
               ORDER BY created_at DESC LIMIT 1`;
  if (client) return (await client.query<LaunchIntentRow>(sql, [businessId])).rows[0] ?? null;
  return queryOne<LaunchIntentRow>(sql, [businessId]);
}

// ------------------------------------------------------------------ markets

interface MarketJoinRow {
  id: string;
  business_id: string;
  source: "osm" | "user";
  source_id: string;
  slug: string;
  business_name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  lat: number;
  lng: number;
  claimed_wallet: string | null;
  hidden: boolean;
  project_name: string;
  token_name: string;
  symbol: string;
  token_address: string;
  creator_wallet: string;
  fee_recipient: string;
  quote_token: string;
  quote_symbol: string;
  quote_decimals: number;
  status: "bonding" | "graduated";
  price_raw: string | null;
  total_supply_raw: string | null;
  progress_wad: string | null;
  holders: number | null;
  image_cid: string | null;
  meta_cid: string;
  description: string | null;
  launch_tx: string;
  launch_block: string;
  buy_tax_bps: number;
  sell_tax_bps: number;
  token_version: number;
  pool_address: string | null;
  created_at: Date;
  stats_updated_at: Date | null;
  volume_24h: string;
  trades_24h: string;
  volume_all?: string;
}

const MARKET_SELECT = `
  SELECT m.id, b.id AS business_id, b.source, b.source_id, b.slug, b.name AS business_name, b.category, b.address, b.city,
         b.country, b.website, b.lat, b.lng, b.claimed_wallet, b.hidden,
         m.project_name, m.token_name, m.symbol, m.token_address, m.creator_wallet, m.fee_recipient, m.quote_token, m.quote_symbol,
         m.quote_decimals, m.status, m.price_raw::text, m.total_supply_raw::text, m.progress_wad::text, m.holders,
         m.image_cid, m.meta_cid, m.description, m.launch_tx, m.launch_block::text, m.buy_tax_bps, m.sell_tax_bps,
         m.token_version, m.pool_address, m.created_at, m.stats_updated_at,
         COALESCE(v.volume, 0)::text AS volume_24h, COALESCE(v.trades, 0)::text AS trades_24h
  FROM markets m
  JOIN businesses b ON b.id = m.business_id
  LEFT JOIN LATERAL (
    SELECT SUM(a.quote_volume) AS volume, COUNT(*) AS trades FROM activity a
    WHERE a.market_id = m.id AND a.type IN ('buy','sell') AND a."timestamp" > now() - interval '24 hours'
  ) v ON true`;

function toSummary(r: MarketJoinRow): MarketSummary {
  const price = r.price_raw ? BigInt(r.price_raw) : null;
  const supply = r.total_supply_raw ? BigInt(r.total_supply_raw) : null;
  return {
    id: r.id,
    slug: r.slug,
    businessName: r.business_name,
    category: r.category,
    city: r.city,
    country: r.country,
    lat: r.lat,
    lng: r.lng,
    claimed: Boolean(r.claimed_wallet),
    projectName: r.project_name,
    tokenName: r.token_name,
    symbol: r.symbol,
    tokenAddress: r.token_address,
    creatorWallet: r.creator_wallet,
    quoteToken: r.quote_token,
    quoteSymbol: r.quote_symbol,
    quoteDecimals: r.quote_decimals,
    status: r.status,
    priceWad: r.price_raw,
    marketCapWad: price !== null && supply !== null ? marketCapWad(price, supply).toString() : null,
    progressWad: r.progress_wad,
    volume24h: r.volume_24h,
    trades24h: Number(r.trades_24h),
    holders: r.holders,
    imageUrl: r.image_cid ? `/api/ipfs/${r.image_cid}` : null,
    launchTx: r.launch_tx,
    createdAt: r.created_at.toISOString(),
    statsUpdatedAt: r.stats_updated_at?.toISOString() ?? null,
  };
}

export interface MarketListParams {
  section: "trending" | "new" | "graduated" | "all";
  status?: "bonding" | "graduated";
  quote?: string; // address
  q?: string;
  limit: number;
  offset: number;
}

export async function listMarkets(p: MarketListParams): Promise<{ items: MarketSummary[]; total: number }> {
  const where: string[] = [`b.hidden = false`];
  const params: unknown[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const status = p.section === "graduated" ? "graduated" : p.status;
  if (status) where.push(`m.status = ${add(status)}`);
  if (p.quote) where.push(`m.quote_token = ${add(p.quote.toLowerCase())}`);
  if (p.q) {
    const q = p.q.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
      where.push(`m.token_address = ${add(q.toLowerCase())}`);
    } else {
      const like = add(`%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
      where.push(`(b.name ILIKE ${like} OR b.city ILIKE ${like} OR b.country ILIKE ${like} OR m.symbol ILIKE ${like} OR m.token_name ILIKE ${like})`);
    }
  }
  if (p.section === "trending") where.push(`COALESCE(v.trades, 0) > 0`);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const order =
    p.section === "trending"
      ? `ORDER BY COALESCE(v.volume, 0) DESC, m.created_at DESC`
      : p.section === "graduated"
        ? `ORDER BY m.graduated_at DESC NULLS LAST, m.created_at DESC`
        : `ORDER BY m.created_at DESC`;
  const rows = await query<MarketJoinRow & { total: string }>(
    `${MARKET_SELECT.replace("SELECT m.id", "SELECT COUNT(*) OVER() AS total, m.id")} ${whereSql} ${order}
     LIMIT ${add(p.limit)} OFFSET ${add(p.offset)}`,
    params,
  );
  return { items: rows.map(toSummary), total: rows[0] ? Number(rows[0].total) : 0 };
}

export async function getMarketBySlug(slug: string): Promise<MarketDetail | null> {
  const r = await queryOne<MarketJoinRow>(
    `${MARKET_SELECT.replace(
      "FROM markets m",
      `, (SELECT COALESCE(SUM(quote_volume),0)::text FROM activity WHERE market_id = m.id AND type IN ('buy','sell')) AS volume_all
       FROM markets m`,
    )} WHERE b.slug = lower($1)`,
    [slug],
  );
  if (!r) return null;
  return {
    ...toSummary(r),
    businessId: r.business_id,
    source: r.source,
    sourceId: r.source_id,
    address: r.address,
    website: r.website,
    hidden: r.hidden,
    claimedWallet: r.claimed_wallet,
    feeRecipient: r.fee_recipient,
    description: r.description,
    metaCid: r.meta_cid,
    buyTaxBps: r.buy_tax_bps,
    sellTaxBps: r.sell_tax_bps,
    tokenVersion: r.token_version,
    launchBlock: r.launch_block,
    poolAddress: r.pool_address,
    totalSupplyRaw: r.total_supply_raw,
    volumeAll: r.volume_all ?? "0",
  };
}

export async function listActivity(marketId: string, limit: number, before?: Date): Promise<ActivityItem[]> {
  const rows = await query<{
    type: ActivityItem["type"]; venue: ActivityItem["venue"]; wallet: string | null; tx_hash: string;
    amount_in: string | null; amount_out: string | null; quote_volume: string | null; timestamp: Date;
  }>(
    `SELECT type, venue, wallet, tx_hash, amount_in::text, amount_out::text, quote_volume::text, "timestamp"
     FROM activity WHERE market_id = $1 ${before ? `AND "timestamp" < $3` : ""}
     ORDER BY "timestamp" DESC, log_index DESC LIMIT $2`,
    before ? [marketId, limit, before] : [marketId, limit],
  );
  return rows.map((r) => ({
    type: r.type, venue: r.venue, wallet: r.wallet, txHash: r.tx_hash, amountIn: r.amount_in, amountOut: r.amount_out,
    quoteVolume: r.quote_volume, timestamp: r.timestamp.toISOString(),
  }));
}

/** Latest launches, buys and sells across every visible market, newest first (global live feed). */
export async function listRecentTrades(limit: number): Promise<RecentTrade[]> {
  const rows = await query<{
    type: "launch" | "buy" | "sell"; venue: "curve" | "dex"; wallet: string | null; tx_hash: string;
    amount_in: string | null; amount_out: string | null; quote_volume: string | null; timestamp: Date;
    slug: string; name: string; city: string | null; symbol: string; image_cid: string | null; quote_symbol: string; quote_decimals: number;
  }>(
    `SELECT a.type, a.venue, a.wallet, a.tx_hash, a.amount_in::text, a.amount_out::text, a.quote_volume::text, a."timestamp",
            b.slug, b.name, b.city, m.symbol, m.image_cid, m.quote_symbol, m.quote_decimals
     FROM activity a
     JOIN markets m ON m.id = a.market_id
     JOIN businesses b ON b.id = m.business_id
     WHERE a.type IN ('launch','buy','sell') AND b.hidden = false
     ORDER BY a."timestamp" DESC, a.log_index DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    type: r.type,
    venue: r.venue,
    wallet: r.wallet,
    txHash: r.tx_hash,
    tokenAmount: r.type === "buy" ? r.amount_out : r.type === "sell" ? r.amount_in : null,
    quoteVolume: r.quote_volume,
    timestamp: r.timestamp.toISOString(),
    slug: r.slug,
    businessName: r.name,
    city: r.city,
    symbol: r.symbol,
    imageUrl: r.image_cid ? `/api/ipfs/${r.image_cid}` : null,
    quoteSymbol: r.quote_symbol,
    quoteDecimals: r.quote_decimals,
  }));
}
