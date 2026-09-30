# mapin

Tokenize any business on earth. Find a shop, café or restaurant on the world map (or add one that is
missing), and launch its token on **Robinhood Chain** through **Pons v2**. A fixed share of every trade
(default 0.7 %) is held for the real owner until they claim the business.

* Map: MapLibre + OpenFreeMap vector tiles (OpenStreetMap, every country, street level, no API key)
* Places: OpenStreetMap via Nominatim (search) and Overpass (what you tapped on the map)
* Chain: Robinhood Chain (4663, ETH) · launch, buy and sell through Pons v2 · graduation to Uniswap v4
* Pairs: ETH, plus every stock token / stablecoin the Pons factory accepts (TSLA, AAPL, SPY, USDG, …)
* Wallets: Privy (email or any wallet) or the built-in picker · wallet sign-in (SIWE)
* Data: PostgreSQL / Supabase · optional indexer for volume, activity and holders

## How it works

1. **Tap a business** on the map (or search it). mapin looks it up on OpenStreetMap and stores it.
Its name and a suggested ticker are filled in; the launcher can edit both.
2. **Tokenize.** The token's website is the business page on mapin (`/b/<slug>`), so the token is tied
to that place. One place = one token.
3. **Owner share.** Every token's Pons `creatorFeeRecipient` is the **owner escrow** wallet and its creator
fee is `NEXT\_PUBLIC\_OWNER\_FEE\_BPS`. Both are checked by the server before and after the launch.
4. **Claim.** The owner proves control of the business website domain with a DNS TXT record, then an
admin approves the claim on `/admin`. After approval, the escrow holder pays the held share to the
owner's wallet and switches the token's fee recipient to it (Pons lets the current recipient transfer it).
5. **Hide.** Anyone can ask for a business page to be hidden; an admin decides on `/admin`.
(The on-chain token cannot be deleted; mapin just stops listing it.)

Every page says **"Unofficial · not affiliated"** until the owner has claimed the business.

## Setup

1. PostgreSQL (Supabase works): create a database and run `npm run db:migrate`
(or paste `db/migrations/001\_init.sql` into the Supabase SQL editor).
2. Copy `.env.example` → `.env.local` and fill in at least:
`NEXT\_PUBLIC\_APP\_URL`, `SESSION\_SECRET`, `DATABASE\_URL` (+ `DATABASE\_SSL=true` on Supabase),
`NEXT\_PUBLIC\_OWNER\_ESCROW\_ADDRESS`, `ADMIN\_TOKEN`, `METADATA\_UPLOAD\_URL`, and the Privy ids if you use Privy.
3. `npm install` · `npm run dev` · open http://localhost:3000
4. Optional indexer (volume, holders, live feed trades): set `ROBINHOOD\_INDEXER\_RPC\_URL` and run
`npm run indexer`, or call `POST /api/indexer/run` with `Authorization: Bearer <INDEXER\_SECRET>` from a cron.

### Vercel

Add the same variables in Project → Settings → Environment Variables and redeploy. In Privy, add your
domain to the allowed origins.

## Owner escrow

`NEXT\_PUBLIC\_OWNER\_ESCROW\_ADDRESS` receives the owner's share of **every** mapin token. Treat it like a
treasury: a fresh wallet used for nothing else, ideally a Safe multisig or hardware wallet. Its key never
goes into this project. When you approve a claim on `/admin`:

1. Send the business's accumulated share to the claimed wallet (the `/b/<slug>` page shows an estimate:
all-time volume × owner share).
2. From the escrow wallet, transfer the token's creator fee recipient to the owner's wallet, so future
fees go straight to them.

## Map data and limits

* Tiles cover the whole world. How many businesses exist in OpenStreetMap varies by area — big cities are
dense, villages less so. "Add a business" fills the gaps (wallet sign-in required, rate limited,
duplicates within \~11 m with the same name are merged).
* The public Nominatim / Overpass servers are free but fair-use. For real traffic, use a paid or
self-hosted instance (`NOMINATIM\_URL`, `OVERPASS\_URL`), and set `OSM\_CONTACT\_EMAIL`.
* Attribution "© OpenStreetMap contributors" is shown on the map and in the footer; keep it.

## Development

* `npm test` — unit tests (launch plan, curve math, v4, OSM parsing, slugs/tickers)
* `db/tests/scenario.sql` — SQL scenario for the schema (`psql -f` against a scratch database)
* `npm run test:contracts` — read-only checks against the live Pons contracts
* deploy

