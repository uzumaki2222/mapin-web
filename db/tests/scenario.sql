-- SQL scenario for the mapin schema (run on a scratch database after 001_init.sql + 002_places.sql).
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO users (wallet_address) VALUES ('0x1111111111111111111111111111111111111111');

-- upsertPlace (twice: the second call refreshes details and keeps the slug)
PREPARE up(text, text, text) AS
  INSERT INTO places (source_id, slug, name, place_type, region, country, country_code, lat, lng, bbox_w, bbox_s, bbox_e, bbox_n, added_by_user_id)
  VALUES ($1, $2, $3, 'City', 'New York, United States', 'United States', 'US', 40.71, -74.0, -74.25, 40.49, -73.70, 40.91, NULL)
  ON CONFLICT (source, source_id) DO UPDATE SET
    name = CASE WHEN EXISTS (SELECT 1 FROM markets m WHERE m.place_id = places.id) THEN places.name ELSE EXCLUDED.name END,
    place_type = EXCLUDED.place_type, region = EXCLUDED.region, country = EXCLUDED.country, country_code = EXCLUDED.country_code,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, bbox_w = EXCLUDED.bbox_w, bbox_s = EXCLUDED.bbox_s, bbox_e = EXCLUDED.bbox_e,
    bbox_n = EXCLUDED.bbox_n, updated_at = now();
EXECUTE up('relation/175905', 'new-york-city-a1b2c3', 'New York City');
EXECUTE up('relation/175905', 'new-york-city-ffffff', 'City of New York');
SELECT slug = 'new-york-city-a1b2c3' AS slug_kept, name = 'City of New York' AS name_refreshed FROM places;

INSERT INTO launch_intents (place_id, creator_wallet, predicted_token, meta_cid, token_name, symbol, quote_token, config, expires_at)
SELECT id, '0x1111111111111111111111111111111111111111', '0xabcabcabcabcabcabcabcabcabcabcabcabc8888', 'bafkreimeta', 'New York City', 'NYC',
       '0x0000000000000000000000000000000000000000', '{}', now() + interval '30 minutes' FROM places;

-- insert as lib/market/finalize.ts does ($3 reused for fee_recipient)
INSERT INTO markets (place_id, creator_user_id, creator_wallet, fee_recipient, token_address, token_name, symbol, project_name,
                     description, meta_cid, image_cid, quote_token, quote_symbol, quote_decimals, token_version,
                     buy_tax_bps, sell_tax_bps, launch_tx, launch_block, status, price_raw, reserve_raw,
                     circulating_raw, total_supply_raw, progress_wad, stats_updated_at, created_at)
SELECT p.id, u.id, u.wallet_address, u.wallet_address, '0xabcabcabcabcabcabcabcabcabcabcabcabc8888', 'New York City', 'NYC', p.name,
       'desc', 'bafkreimeta', 'bafkreiimg', '0x0000000000000000000000000000000000000000', 'BNB', 18, 6,
       100, 100, '0x' || repeat('ab', 32), 62000000, 'bonding', 1000, 0, 0, 1000000000000000000000000000, 0, now(), now()
FROM places p, users u;

SAVEPOINT s1;
DO $$ BEGIN
  INSERT INTO markets (place_id, creator_user_id, creator_wallet, fee_recipient, token_address, token_name, symbol, project_name, meta_cid,
                       quote_token, quote_symbol, quote_decimals, token_version, launch_tx, launch_block)
  SELECT place_id, creator_user_id, creator_wallet, fee_recipient, '0xdddddddddddddddddddddddddddddddddddd8888', 'x', 'X', 'x', 'm',
         quote_token, 'BNB', 18, 6, '0x' || repeat('cd', 32), 1 FROM markets LIMIT 1;
  RAISE EXCEPTION 'duplicate market was accepted';
EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT LIKE '%markets_place_id_key%' THEN RAISE; END IF;
END $$;
RELEASE SAVEPOINT s1;

UPDATE markets SET pool_address = '0x1234567890123456789012345678901234567890', status = 'graduated';

INSERT INTO activity (market_id, type, venue, wallet, tx_hash, log_index, block_number, block_hash, amount_in, amount_out, quote_volume, "timestamp")
SELECT id, 'buy', 'curve', '0x1111111111111111111111111111111111111111', '0x' || repeat('11', 32), 1, 62000001, '0x' || repeat('22', 32),
       500000000000000000, 1000, 500000000000000000, now() FROM markets;

-- live feed (listRecentTrades) and pins
SELECT count(*) = 1 AS feed_row FROM activity a JOIN markets m ON m.id = a.market_id JOIN places p ON p.id = m.place_id
WHERE a.type IN ('launch','buy','sell') AND p.hidden = false;
SELECT count(*) = 1 AS pin_in_bbox FROM markets m JOIN places p ON p.id = m.place_id WHERE p.lat BETWEEN 40 AND 41 AND p.lng BETWEEN -75 AND -73;

INSERT INTO reports (place_id, reason) SELECT id, 'offensive logo' FROM places;
UPDATE places SET hidden = true;
SELECT count(*) = 0 AS hidden_not_listed FROM markets m JOIN places p ON p.id = m.place_id WHERE p.hidden = false;
ROLLBACK;
