import Link from "next/link";

const STEPS = [
  ["01", "Pick a place", "Open the map and click anywhere. Zoomed out you pick a country; zoom in for a state, a city, a town or a single neighbourhood."],
  ["02", "Launch its token", "Name and ticker are filled in for you — New York City becomes $NYC. Add a logo, choose your creator fee and launch."],
  ["03", "Trade", "Every token starts on a bonding curve on BNB Smart Chain. Buys and sells show up live across the site."],
  ["04", "Graduate", "When 80% of the supply is sold, liquidity moves to PancakeSwap and trading carries on there."],
];

export default function LandingPage() {
  return (
    <div className="landing">
      <section className="container landing-hero">
        <div className="landing-kicker">BNB Smart Chain · Launched on Flap</div>
        <h1>Tokenize any place on earth.</h1>
        <p className="landing-lead">
          mapin is a launchpad on a world map. Every country, state, city, town and neighbourhood can have exactly one
          token — and whoever launches it first earns the creator fees.
        </p>
        <div className="row" style={{ gap: 12 }}>
          <Link href="/app" className="btn btn-primary btn-lg">Launch App</Link>
          <Link href="/docs" className="btn btn-lg">Read the docs</Link>
        </div>
      </section>

      <section className="container landing-section">
        <h2>How it works</h2>
        <ol className="landing-steps">
          {STEPS.map(([n, title, text]) => (
            <li key={n}>
              <span className="landing-num">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="container landing-section landing-cols">
        <div>
          <h2>One place, one token</h2>
          <p>
            Places come from OpenStreetMap, so every border on the planet is already on the map. Each place can be
            launched once. $NYC, $TOKYO, $BALI or the village you grew up in — if it is on the map, it can have a market.
          </p>
        </div>
        <div>
          <h2>Creator fees</h2>
          <p>
            When you launch a place you can set a fee on buys and sells, paid straight to your wallet by the token
            contract on every trade. You choose the rate, how long it runs and how it is split between you, a burn and
            liquidity.
          </p>
        </div>
        <div>
          <h2>Live, on-chain</h2>
          <p>
            Every launch, buy and sell is read from BNB Smart Chain and scrolls across the top of the site as it
            happens. No custody: you trade from your own wallet, and every transaction is simulated before you sign.
          </p>
        </div>
      </section>

      <section className="container landing-section landing-cta">
        <h2>Which place will you put on the map?</h2>
        <Link href="/app" className="btn btn-primary btn-lg">Launch App</Link>
      </section>
    </div>
  );
}
