-- mapin — schema (PostgreSQL 14+ / Supabase compatible)
--
-- Conventions
--   * Every EVM address is stored lower-case, 0x-prefixed, 42 chars (CHECK enforced).
--   * Every tx hash is stored lower-case, 0x-prefixed, 66 chars.
--   * Token / quote amounts are stored as NUMERIC(78,0) raw integer units (never floats).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE DOMAIN evm_address AS TEXT CHECK (VALUE ~ '^0x[0-9a-f]{40}$');
CREATE DOMAIN evm_hash    AS TEXT CHECK (VALUE ~ '^0x[0-9a-f]{64}$');
CREATE DOMAIN uint256     AS NUMERIC(78, 0) CHECK (VALUE >= 0);

-- ---------------------------------------------------------------------------
-- Users: a wallet identity.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address   evm_address NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions: opaque random id in an httpOnly cookie, holding the SIWE-verified wallet.
CREATE TABLE sessions (
  id                      TEXT PRIMARY KEY,               -- sha256(cookie value), hex
  wallet_address          evm_address,
  wallet_verified_at      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at              TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- SIWE nonces: single use, short lived, bound to a session.
CREATE TABLE auth_nonces (
  nonce       TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Businesses: a real-world place. Identity is (source, source_id):
--   source = 'osm'  → source_id = 'node/123' | 'way/456' | 'relation/789' (OpenStreetMap)
--   source = 'user' → source_id = random id (added by a user from the map)
-- ---------------------------------------------------------------------------
CREATE TABLE businesses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT NOT NULL CHECK (source IN ('osm', 'user')),
  source_id         TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name              TEXT NOT NULL,
  category          TEXT,
  address           TEXT,
  city              TEXT,
  country           TEXT,
  country_code      TEXT,
  website           TEXT,
  lat               DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng               DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  -- dedupe key for user-added places: lower(name) + coordinates rounded to ~11 m
  dedupe_key        TEXT,
  added_by_user_id  UUID REFERENCES users(id),
  -- owner claim (set by an admin after the claim is verified)
  claimed_wallet    evm_address,
  claimed_at        TIMESTAMPTZ,
  -- hidden at the owner's request (the on-chain token cannot be removed; the page and pins are)
  hidden            BOOLEAN NOT NULL DEFAULT false,
  hidden_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE UNIQUE INDEX businesses_dedupe_uq ON businesses (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX businesses_geo_idx ON businesses (lat, lng);

-- ---------------------------------------------------------------------------
-- Launch intents: a short-lived reservation created right before the wallet
-- is asked to sign. Prevents two people racing to tokenize the same business.
-- ---------------------------------------------------------------------------
CREATE TABLE launch_intents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  creator_wallet    evm_address NOT NULL,
  predicted_token   evm_address,
  meta_cid          TEXT NOT NULL,
  token_name        TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  quote_token       evm_address NOT NULL,
  config            JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  consumed_at       TIMESTAMPTZ
);
CREATE INDEX launch_intents_business_idx ON launch_intents (business_id, expires_at);

-- ---------------------------------------------------------------------------
-- Markets: exactly one canonical market per business.
-- ---------------------------------------------------------------------------
CREATE TABLE markets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL UNIQUE REFERENCES businesses(id),
  creator_user_id      UUID NOT NULL REFERENCES users(id),
  creator_wallet       evm_address NOT NULL,
  fee_recipient        evm_address NOT NULL,             -- Pons creatorFeeRecipient (the owner escrow)
  token_address        evm_address NOT NULL UNIQUE,
  token_name           TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  project_name         TEXT NOT NULL,
  description          TEXT,
  meta_cid             TEXT NOT NULL,
  image_cid            TEXT,
  quote_token          evm_address NOT NULL,             -- 0x000…000 = native ETH on Robinhood Chain
  quote_symbol         TEXT NOT NULL,
  quote_decimals       SMALLINT NOT NULL,
  token_version        SMALLINT NOT NULL,
  buy_tax_bps          INTEGER NOT NULL DEFAULT 0,       -- Pons creator fee (bps) = the owner's share
  sell_tax_bps         INTEGER NOT NULL DEFAULT 0,
  launch_tx            evm_hash NOT NULL UNIQUE,
  launch_block         BIGINT NOT NULL,
  curve_address        evm_address,
  status               TEXT NOT NULL DEFAULT 'bonding' CHECK (status IN ('bonding', 'graduated')),
  price_raw            uint256,                          -- quote per 1 token, 1e18 scaled
  reserve_raw          uint256,
  circulating_raw      uint256,
  total_supply_raw     uint256,
  progress_wad         uint256,                          -- 1e18 = 100 %
  pool_address         TEXT CHECK (pool_address IS NULL OR pool_address ~ '^0x[0-9a-f]{64}$'), -- Uniswap v4 pool id
  pool_verified_at     TIMESTAMPTZ,
  holders              INTEGER,
  stats_updated_at     TIMESTAMPTZ,
  graduated_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX markets_status_idx ON markets (status);
CREATE INDEX markets_quote_idx ON markets (quote_token);
CREATE INDEX markets_created_idx ON markets (created_at DESC);
CREATE INDEX markets_symbol_lc_idx ON markets (lower(symbol));

-- Activity: trades and lifecycle events, idempotent per (tx_hash, log_index).
CREATE TABLE activity (
  id            BIGSERIAL PRIMARY KEY,
  market_id     UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('launch', 'buy', 'sell', 'graduate')),
  venue         TEXT NOT NULL CHECK (venue IN ('curve', 'dex')),
  wallet        evm_address,
  tx_hash       evm_hash NOT NULL,
  log_index     INTEGER NOT NULL,
  block_number  BIGINT NOT NULL,
  block_hash    evm_hash NOT NULL,
  amount_in     uint256,        -- buy: quote in  | sell: tokens in
  amount_out    uint256,        -- buy: tokens out | sell: quote out
  quote_volume  uint256,        -- quote-denominated size of the trade (for volume stats)
  fee           uint256,
  post_price    uint256,
  "timestamp"   TIMESTAMPTZ NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX activity_market_time_idx ON activity (market_id, "timestamp" DESC);
CREATE INDEX activity_block_idx ON activity (block_number);

-- Token transfers for holder counts (only for mapin tokens).
CREATE TABLE token_transfers (
  id            BIGSERIAL PRIMARY KEY,
  market_id     UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  from_address  evm_address NOT NULL,
  to_address    evm_address NOT NULL,
  value         uint256 NOT NULL,
  tx_hash       evm_hash NOT NULL,
  log_index     INTEGER NOT NULL,
  block_number  BIGINT NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX token_transfers_market_idx ON token_transfers (market_id);
CREATE INDEX token_transfers_block_idx ON token_transfers (block_number);

-- ---------------------------------------------------------------------------
-- Owner claims. A claim is verified by a DNS TXT record on the business's own
-- website domain, then approved by an admin (who also moves the escrowed fees).
-- ---------------------------------------------------------------------------
CREATE TABLE claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  wallet          evm_address NOT NULL,
  domain          TEXT NOT NULL,
  domain_matches  BOOLEAN NOT NULL,          -- domain equals the business website domain on record
  token           TEXT NOT NULL,             -- expected TXT value: mapin-verify=<token>
  contact         TEXT,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dns_verified', 'approved', 'rejected')),
  verified_at     TIMESTAMPTZ,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, wallet)
);
CREATE INDEX claims_status_idx ON claims (status, created_at DESC);

-- Removal / takedown requests from anyone (typically the real owner).
CREATE TABLE reports (
  id            BIGSERIAL PRIMARY KEY,
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  contact       TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ERC-20 pair assets approved on the Pons factory (Robinhood stock tokens, USDG, …).
CREATE TABLE pair_tokens (
  address               evm_address PRIMARY KEY,
  approved              BOOLEAN NOT NULL,
  symbol                TEXT,
  name                  TEXT,
  decimals              SMALLINT,
  phantom_quote         uint256,
  graduation_threshold  uint256,
  event_block           BIGINT NOT NULL,
  event_log_index       INTEGER NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexer cursor: restart-safe, stores the hash for reorg detection.
CREATE TABLE indexer_state (
  name                 TEXT PRIMARY KEY,
  first_block          BIGINT NOT NULL,
  last_block           BIGINT NOT NULL,
  last_block_hash      evm_hash,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE indexer_blocks (
  block_number BIGINT PRIMARY KEY,
  block_hash   evm_hash NOT NULL
);

-- Fixed-window rate limiting shared by every app instance.
CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
