-- End-to-end SQL scenario for the mapin schema (run against a scratch database after 001_init.sql).
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO users (wallet_address) VALUES ('0x1111111111111111111111111111111111111111'), ('0x2222222222222222222222222222222222222222');

-- upsertOsmBusiness (twice: second call refreshes details, keeps slug)
PREPARE osm(text, text, text) AS
  INSERT INTO businesses (source, source_id, slug, name, category, address, city, country, country_code, website, lat, lng, added_by_user_id)
  VALUES ('osm', $1, $2, $3, 'Restaurant', 'Jl. Cikini Raya 12', 'Jakarta', 'Indonesia', 'ID', 'https://warungsari.id/', -6.19, 106.84, NULL)
  ON CONFLICT (source, source_id) DO UPDATE SET
    name = CASE WHEN EXISTS (SELECT 1 FROM markets m WHERE m.business_id = businesses.id) THEN businesses.name ELSE EXCLUDED.name END,
    category = EXCLUDED.category, address = EXCLUDED.address, city = EXCLUDED.city, country = EXCLUDED.country,
    country_code = EXCLUDED.country_code, website = EXCLUDED.website, lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now();
EXECUTE osm('node/1', 'warung-sari-rasa-a1b2c3', 'Warung Sari Rasa');
EXECUTE osm('node/1', 'warung-sari-rasa-ffffff', 'Warung Sari Rasa Baru');
SELECT slug = 'warung-sari-rasa-a1b2c3' AS slug_kept, name = 'Warung Sari Rasa Baru' AS name_refreshed FROM businesses WHERE source_id = 'node/1';

-- insertUserBusiness dedupe (same name + ~11 m grid → one row)
PREPARE usr(text, text) AS
  INSERT INTO businesses (source, source_id, slug, name, category, address, city, country, country_code, website, lat, lng, dedupe_key, added_by_user_id)
  VALUES ('user', $1, $2, 'Warung Bu Tini', 'Restaurant', NULL, 'Bandung', 'Indonesia', 'ID', NULL, -6.9, 107.6, 'warungbutini@-6.9000,107.6000',
          (SELECT id FROM users LIMIT 1))
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
EXECUTE usr('aaaaaaaaaaaa', 'warung-bu-tini-aaaaaa');
EXECUTE usr('bbbbbbbbbbbb', 'warung-bu-tini-bbbbbb');
SELECT count(*) = 1 AS user_dedupe_ok FROM businesses WHERE source = 'user';

-- intent + market (column order as in lib/market/finalize.ts)
INSERT INTO launch_intents (business_id, creator_wallet, predicted_token, meta_cid, token_name, symbol, quote_token, config, expires_at)
SELECT id, '0x1111111111111111111111111111111111111111', NULL, 'bafkreimeta', 'Warung Sari Rasa', 'WSR',
       '0x0000000000000000000000000000000000000000', '{"feeRecipient":"0xe5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0","creatorFeeBps":70}', now() + interval '30 minutes'
FROM businesses WHERE source_id = 'node/1';

INSERT INTO markets (business_id, creator_user_id, creator_wallet, fee_recipient, token_address, token_name, symbol, project_name,
                     description, meta_cid, image_cid, quote_token, quote_symbol, quote_decimals, token_version,
                     buy_tax_bps, sell_tax_bps, launch_tx, launch_block, status, price_raw, reserve_raw,
                     circulating_raw, total_supply_raw, progress_wad, stats_updated_at, created_at, curve_address)
SELECT b.id, u.id, u.wallet_address, '0xe5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0', '0xabcabcabcabcabcabcabcabcabcabcabcabcabca', 'Warung Sari Rasa', 'WSR', b.name,
       'desc', 'bafkreimeta', 'bafkreiimg', '0x0000000000000000000000000000000000000000', 'ETH', 18, 2,
       70, 70, '0x' || repeat('ab', 32), 26900000, 'bonding', 1000, 0, 0, 1000000000000000000000000000, 0, now(), now(),
       '0xcccccccccccccccccccccccccccccccccccccccc'
FROM businesses b, users u WHERE b.source_id = 'node/1' AND u.wallet_address = '0x1111111111111111111111111111111111111111';

-- second market for the same business must fail (canonical market per business)
SAVEPOINT s1;
DO $$ BEGIN
  INSERT INTO markets (business_id, creator_user_id, creator_wallet, fee_recipient, token_address, token_name, symbol, project_name, meta_cid,
                       quote_token, quote_symbol, quote_decimals, token_version, launch_tx, launch_block)
  SELECT business_id, creator_user_id, creator_wallet, fee_recipient, '0xdddddddddddddddddddddddddddddddddddddddd', 'x', 'X', 'x', 'm',
         quote_token, 'ETH', 18, 2, '0x' || repeat('cd', 32), 1 FROM markets LIMIT 1;
  RAISE EXCEPTION 'duplicate market was accepted';
EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT LIKE '%markets_business_id_key%' THEN RAISE; END IF;
END $$;
RELEASE SAVEPOINT s1;

INSERT INTO activity (market_id, type, venue, wallet, tx_hash, log_index, block_number, block_hash, amount_in, amount_out, quote_volume, "timestamp")
SELECT id, 'buy', 'curve', '0x2222222222222222222222222222222222222222', '0x' || repeat('11', 32), 1, 26900001, '0x' || repeat('22', 32),
       500000000000000000, 1000, 500000000000000000, now() FROM markets;

-- pins query (bbox around Jakarta; and one crossing the antimeridian that excludes it)
SELECT count(*) = 1 AS pin_in_bbox FROM markets m JOIN businesses b ON b.id = m.business_id
WHERE b.hidden = false AND b.lat BETWEEN -7 AND -6 AND b.lng BETWEEN 106 AND 107;
SELECT count(*) = 0 AS antimeridian_ok FROM markets m JOIN businesses b ON b.id = m.business_id
WHERE b.hidden = false AND b.lat BETWEEN -90 AND 90 AND (b.lng >= 170 OR b.lng <= -170);

-- MARKET_SELECT by slug
SELECT b.slug, b.name AS business_name, m.symbol, m.fee_recipient, COALESCE(v.volume, 0)::text AS volume_24h
FROM markets m JOIN businesses b ON b.id = m.business_id
LEFT JOIN LATERAL (SELECT SUM(a.quote_volume) AS volume, COUNT(*) AS trades FROM activity a
  WHERE a.market_id = m.id AND a.type IN ('buy','sell') AND a."timestamp" > now() - interval '24 hours') v ON true
WHERE b.slug = lower('Warung-Sari-Rasa-A1B2C3');

-- claims upsert (same statement as app/api/claims)
PREPARE cl(text, text) AS
  INSERT INTO claims (business_id, wallet, domain, domain_matches, token, contact, note)
  SELECT id, '0x2222222222222222222222222222222222222222', $1, $1 = 'warungsari.id', $2, NULL, NULL FROM businesses WHERE source_id = 'node/1'
  ON CONFLICT (business_id, wallet) DO UPDATE SET
    domain = EXCLUDED.domain, domain_matches = EXCLUDED.domain_matches, contact = EXCLUDED.contact, note = EXCLUDED.note,
    token = CASE WHEN claims.domain = EXCLUDED.domain THEN claims.token ELSE EXCLUDED.token END,
    status = CASE WHEN claims.status = 'approved' THEN claims.status ELSE 'pending' END,
    verified_at = NULL
  RETURNING domain, domain_matches, token, status;
EXECUTE cl('warungsari.id', 'tok1');
EXECUTE cl('warungsari.id', 'tok2');   -- same domain keeps the token
SELECT token = 'tok1' AS token_kept FROM claims;
UPDATE claims SET status = 'dns_verified', verified_at = now();
UPDATE businesses SET claimed_wallet = '0x2222222222222222222222222222222222222222', claimed_at = now() WHERE source_id = 'node/1';
UPDATE claims SET status = 'approved', decided_at = now();

-- hide + report
INSERT INTO reports (business_id, reason) SELECT id, 'I am the owner' FROM businesses WHERE source_id = 'node/1';
UPDATE businesses SET hidden = true, hidden_reason = 'owner request' WHERE source_id = 'node/1';
SELECT count(*) = 0 AS hidden_not_listed FROM markets m JOIN businesses b ON b.id = m.business_id WHERE b.hidden = false;

-- slug check constraint
SAVEPOINT s2;
DO $$ BEGIN
  INSERT INTO businesses (source, source_id, slug, name, lat, lng) VALUES ('user', 'zzz', 'Bad Slug', 'x', 0, 0);
  RAISE EXCEPTION 'bad slug accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
RELEASE SAVEPOINT s2;
ROLLBACK;
