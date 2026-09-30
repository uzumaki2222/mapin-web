import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs",
  description: "How mapin works: picking a place, launching its token, creator fees, trading and graduation on BNB Smart Chain.",
};

const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "places", title: "Picking a place" },
  { id: "launch", title: "Launching a token" },
  { id: "creator-fees", title: "Creator fees" },
  { id: "trading", title: "Trading and graduation" },
  { id: "fees", title: "Fees at a glance" },
  { id: "live", title: "Live feed" },
  { id: "map-data", title: "Map data" },
  { id: "safety", title: "Safety and risks" },
  { id: "faq", title: "FAQ" },
];

export default function DocsPage() {
  return (
    <div className="container section docs">
      <aside className="docs-nav" aria-label="Contents">
        <div className="panel-title">Docs</div>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>
          ))}
        </ul>
        <Link href="/app" className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>Launch App</Link>
      </aside>

      <article className="docs-body">
        <h1>mapin docs</h1>

        <section id="overview">
          <h2>Overview</h2>
          <p>
            mapin is a token launchpad built on a world map. Any area on the map — a country, a state or province, a
            city, a town, a village or a neighbourhood — can have exactly one token. The first person to launch a place
            creates its market and can earn creator fees on every trade.
          </p>
          <p>
            Tokens are created and traded on <strong>BNB Smart Chain</strong> through the <strong>Flap</strong> launch
            protocol: every token starts on a bonding curve and graduates to PancakeSwap once enough of the supply has
            been bought. mapin never holds your funds — you sign every transaction in your own wallet.
          </p>
        </section>

        <section id="places">
          <h2>Picking a place</h2>
          <p>Open the <Link href="/app">app</Link> and click anywhere on the map. What you pick depends on how far you are zoomed in:</p>
          <ul>
            <li><strong>Zoomed out</strong> — the country (for example United States).</li>
            <li><strong>Closer</strong> — the state, province or region (New York State).</li>
            <li><strong>Closer still</strong> — the city (New York City).</li>
            <li><strong>Street level</strong> — the town, borough or neighbourhood (Brooklyn).</li>
          </ul>
          <p>
            After a click, the panel lists every area that contains that point, so you can switch between them without
            zooming — Brooklyn → New York City → New York → United States. The selected area is outlined on the map.
          </p>
          <p>You can also search by name. Search results only include areas; streets, buildings and shops cannot be tokenized.</p>
        </section>

        <section id="launch">
          <h2>Launching a token</h2>
          <ol>
            <li>Connect a wallet on BNB Smart Chain and sign in (a free signature, not a transaction).</li>
            <li>Pick a place and press <em>Tokenize</em>.</li>
            <li>
              Check the token name and ticker. They are filled in from the place name — several words become initials
              (New York City → <code>$NYC</code>), a single word stays as it is (<code>$TOKYO</code>). You can change both.
            </li>
            <li>Upload a logo (PNG, JPEG, WebP or GIF, up to 2 MB). A flag, skyline or landmark works well.</li>
            <li>Choose the pair (BNB or a stablecoin the protocol currently accepts), an optional initial buy and your creator fees.</li>
            <li>
              Review and launch. mapin simulates the transaction first; if the simulation fails, nothing is sent. Your
              wallet then asks you to confirm.
            </li>
          </ol>
          <p>
            The token&apos;s metadata points to its page on mapin, which ties the token to the place. Each place can only
            be launched once; if someone else is already launching the same place, you will be asked to wait a few minutes.
          </p>
        </section>

        <section id="creator-fees">
          <h2>Creator fees</h2>
          <p>
            Creator fees are a percentage taken from every buy and every sell by the token contract and sent to the
            creator&apos;s wallet. They are optional and set once, at launch:
          </p>
          <ul>
            <li><strong>Fee on buys / fee on sells</strong> — each up to 10%.</li>
            <li><strong>Duration</strong> — from 30 days to permanent. After it ends, trades are fee-free.</li>
            <li><strong>Anti-farming window</strong> — a short period after launch that discourages instant flipping.</li>
            <li>
              <strong>Split</strong> — by default 100% goes to the creator. You can send part of it to a burn or to
              liquidity instead.
            </li>
          </ul>
          <p>Fee settings are written into the token contract and cannot be changed after launch. Every market page shows them.</p>
        </section>

        <section id="trading">
          <h2>Trading and graduation</h2>
          <p>
            New tokens trade on a bonding curve: the price rises as tokens are bought and falls as they are sold. Buy
            and sell directly from a place&apos;s page; every trade shows the expected amount and minimum received before
            you sign.
          </p>
          <p>
            When 80% of the supply has been sold on the curve, the token <strong>graduates</strong>: its liquidity moves
            to a PancakeSwap pool and trading continues there. mapin keeps working the same way — the trade panel
            switches to the pool automatically.
          </p>
        </section>

        <section id="fees">
          <h2>Fees at a glance</h2>
          <table className="table">
            <thead><tr><th>Fee</th><th>Who sets it</th><th>Where it goes</th></tr></thead>
            <tbody>
              <tr><td>Protocol trading fee</td><td>The launch protocol (read live, shown before you trade)</td><td>The protocol</td></tr>
              <tr><td>Creator fees</td><td>The creator, at launch (0–10% per side)</td><td>Creator wallet / burn / liquidity</td></tr>
              <tr><td>Network gas</td><td>BNB Smart Chain</td><td>Validators — shown in your wallet</td></tr>
            </tbody>
          </table>
          <p>mapin itself does not add a fee on top.</p>
        </section>

        <section id="live">
          <h2>Live feed</h2>
          <p>
            Every launch, buy and sell is read from the chain and appears in the strip at the top of every page and in
            the live feed on the map within seconds. Click any entry to open that place&apos;s market.
          </p>
        </section>

        <section id="map-data">
          <h2>Map data</h2>
          <p>
            Borders and place names come from OpenStreetMap (© OpenStreetMap contributors) and are shown in English
            where an English name exists. Map tiles are served by OpenFreeMap. Every place on a market page links to its
            OpenStreetMap entry.
          </p>
        </section>

        <section id="safety">
          <h2>Safety and risks</h2>
          <ul>
            <li>Tokens on mapin are community tokens. They are not issued or endorsed by any government, city or organisation.</li>
            <li>Prices can go to zero. Only use money you can afford to lose.</li>
            <li>Always check the contract address on the market page before trading.</li>
            <li>mapin never asks for your seed phrase or private key.</li>
            <li>Offensive or misleading token pages can be reported from the market page and may be hidden.</li>
          </ul>
        </section>

        <section id="faq">
          <h2>FAQ</h2>
          <h3>Can two tokens exist for the same place?</h3>
          <p>No. Each place on the map can be launched once. Bigger and smaller areas are different places, so $USA and $NYC can both exist.</p>
          <h3>Can I change the name, ticker or fees after launch?</h3>
          <p>No. They are part of the token contract. Choose carefully on the review step.</p>
          <h3>Which wallets work?</h3>
          <p>Any wallet on BNB Smart Chain — browser wallets, WalletConnect, or an email login that creates a wallet for you.</p>
          <h3>My place is not on the map.</h3>
          <p>mapin uses OpenStreetMap areas. If a boundary is missing there, it can be added on openstreetmap.org and will appear on mapin after it is published.</p>
        </section>
      </article>
    </div>
  );
}
