# mapin

A token launchpad on a world map. Every area on earth — country, state, city, town, village, neighbourhood — can
have exactly one token, launched and traded on **BNB Smart Chain** through the **Flap** launch protocol. Whoever
launches a place can earn creator fees on every trade.

* `/` — landing page (text only, "Launch App")
* `/app` — the world map: click anywhere to pick an area (zoom decides the level), switch between bigger and smaller
  areas, see the border, tokenize it
* `/p/<slug>` — a place's market: stats, trade panel (bonding curve, then PancakeSwap), activity
* `/explore` — all markets · `/docs` — user docs · `/admin` — reports (ADMIN_TOKEN)
* Live strip at the top of every page with the latest launches, buys and sells

Map: MapLibre + OpenFreeMap tiles. Places, borders and search: OpenStreetMap Nominatim (English names).

## Setup

1. **Database** (PostgreSQL or Supabase): run `db/migrations/001_init.sql`, then `db/migrations/002_places.sql`
   (Supabase: paste each into SQL Editor → Run), or `npm run db:migrate`.
2. **Environment** (`.env.example` lists everything). Minimum:
   `NEXT_PUBLIC_APP_URL`, `SESSION_SECRET`, `DATABASE_URL` (+ `DATABASE_SSL=true` for Supabase),
   `METADATA_UPLOAD_URL`, `IPFS_GATEWAY_URL`, `NEXT_PUBLIC_PRIVY_APP_ID` / `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `ADMIN_TOKEN`,
   `OSM_CONTACT_EMAIL`.
3. **Live feed.** Launches and every buy/sell made on mapin are recorded instantly from the transaction receipt (no
   extra setup). To also catch trades made elsewhere (Flap, PancakeSwap, bots), set `INDEXER_RPC_URL`: a BNB Smart Chain RPC that allows `eth_getLogs`
   (free tiers from NodeReal, Ankr, QuickNode, Alchemy …). With it set, the site indexes new trades by itself
   every few seconds while anyone has it open. Launches appear in the feed even without it.
4. `npm install` · `npm run dev`.

On Vercel: add the same variables, deploy, and add the domain to the Privy dashboard's allowed origins.

## How a launch works

1. The browser asks `/api/places/at` (map click) or `/api/places/resolve` (search) for the area; the server looks it
   up on OpenStreetMap and stores it (`places`, identity = OSM element id).
2. `/api/metadata` pins the logo + metadata JSON; the metadata website is the place page, binding token ↔ place.
3. The browser grinds a CREATE2 salt for a Flap vanity address (…8888, or …7777 for creator-fee tokens) in a worker.
4. `/api/markets/prepare` re-checks everything and reserves the place; the wallet signs `Portal.newTokenV6`.
5. `/api/markets/confirm` verifies the receipt on-chain and records the market (the indexer recovers it if the
   browser closed).

Creator fees are Flap tax-token settings (buy/sell rate up to 10%, duration, anti-farming window, split between the
creator wallet, burn and liquidity), fixed at launch.

## Development

* `npm test` — unit tests (launch params, market state, OSM parsing, slugs/tickers, metadata)
* `db/tests/scenario.sql` — SQL scenario for the schema
* `npm run test:contracts` — read-only checks against the live contracts
