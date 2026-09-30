-- mapin now tokenizes places (countries, states, cities, towns, villages, neighbourhoods …) instead of
-- businesses. No tokens were launched with the business version, so its tables are replaced.
-- Safe to run whether or not 001_init.sql was applied before (it must be, since it creates the domains).

DROP TABLE IF EXISTS claims CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS token_transfers CASCADE;
DROP TABLE IF EXISTS activity CASCADE;
DROP TABLE IF EXISTS markets CASCADE;
DROP TABLE IF EXISTS launch_intents CASCADE;
DROP TABLE IF EXISTS businesses CASCADE;

-- ---------------------------------------------------------------------------
-- Places: an area on the map. Identity is its OpenStreetMap element
-- (relation/123 for most administrative areas, node/456 for many towns and villages).
-- Names are stored in English.
-- ---------------------------------------------------------------------------
CREATE TABLE places (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT NOT NULL DEFAULT 'osm' CHECK (source IN ('osm')),
  source_id         TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name              TEXT NOT NULL,
  place_type        TEXT,                 -- Country, State, City, Town, Village, Neighbourhood, …
  region            TEXT,                 -- the areas it belongs to, e.g. "New York, United States"
  country           TEXT,
  country_code      TEXT,
  lat               DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng               DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  -- bounding box: west, south, east, north
  bbox_w            DOUBLE PRECISION,
  bbox_s            DOUBLE PRECISION,
  bbox_e            DOUBLE PRECISION,
  bbox_n            DOUBLE PRECISION,
  added_by_user_id  UUID REFERENCES users(id),
  hidden            BOOLEAN NOT NULL DEFAULT false,
  hidden_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX places_geo_idx ON places (lat, lng);

CREATE TABLE launch_intents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id          UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
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
CREATE INDEX launch_intents_place_idx ON launch_intents (place_id, expires_at);

-- Exactly one canonical market per place.
CREATE TABLE markets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id             UUID NOT NULL UNIQUE REFERENCES places(id),
  creator_user_id      UUID NOT NULL REFERENCES users(id),
  creator_wallet       evm_address NOT NULL,
  fee_recipient        evm_address NOT NULL,             -- receives the creator fee (tax share): the creator
  token_address        evm_address NOT NULL UNIQUE,
  token_name           TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  project_name         TEXT NOT NULL,
  description          TEXT,
  meta_cid             TEXT NOT NULL,
  image_cid            TEXT,
  quote_token          evm_address NOT NULL,             -- 0x000…000 = native BNB
  quote_symbol         TEXT NOT NULL,
  quote_decimals       SMALLINT NOT NULL,
  token_version        SMALLINT NOT NULL,
  buy_tax_bps          INTEGER NOT NULL DEFAULT 0,       -- creator fee: buy tax (bps)
  sell_tax_bps         INTEGER NOT NULL DEFAULT 0,
  launch_tx            evm_hash NOT NULL UNIQUE,
  launch_block         BIGINT NOT NULL,
  curve_address        evm_address,
  status               TEXT NOT NULL DEFAULT 'bonding' CHECK (status IN ('bonding', 'graduated')),
  price_raw            uint256,
  reserve_raw          uint256,
  circulating_raw      uint256,
  total_supply_raw     uint256,
  progress_wad         uint256,
  pool_address         evm_address,                      -- PancakeSwap pair after graduation
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
  amount_in     uint256,
  amount_out    uint256,
  quote_volume  uint256,
  fee           uint256,
  post_price    uint256,
  "timestamp"   TIMESTAMPTZ NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX activity_market_time_idx ON activity (market_id, "timestamp" DESC);
CREATE INDEX activity_block_idx ON activity (block_number);

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

-- Reports (abuse / offensive token) reviewed on /admin.
CREATE TABLE reports (
  id            BIGSERIAL PRIMARY KEY,
  place_id      UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  contact       TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexer cursors restart from scratch for the new market set.
DELETE FROM indexer_blocks;
DELETE FROM indexer_state WHERE name <> 'pairs';
