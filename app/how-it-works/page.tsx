import Link from "next/link";

export const metadata = { title: "How it works", description: "How mapin works: tokens on countries, paired with currency coins, bonding curves and graduation on Robinhood Chain." };

const STEPS = [
  { n: "01", t: "Pick a country", d: "Open the map and click any of 244 countries. Each one is registered on-chain with its national currency: Algeria uses DZD, Malaysia MYR, the United Kingdom GBP, the eurozone EUR." },
  { n: "02", t: "Name your token", d: "Type any name and ticker you want. You are not limited to one token per country: anyone can launch as many tokens on a country as they like." },
  { n: "03", t: "It pairs with the currency coin", d: "Your token trades against that country's currency coin, for example $DZD. If the currency coin does not exist yet, your launch creates it in the same transaction and you become its creator too." },
  { n: "04", t: "People trade with ETH", d: "Buyers pay ETH. The contract swaps ETH into the currency coin, then into your token, in one transaction. Selling runs the same route backwards. Holders of the currency coin can also trade directly." },
  { n: "05", t: "Graduate to Uniswap", d: "Every token has a bonding curve: the price rises as people buy. When 80% of the supply (800M) is sold, the raised coins and 200M tokens go into the token's own Uniswap V2 pool, like UPIN/MYR, automatically. The LP is burned, so that liquidity is locked for good." },
];

const FACTS = [
  ["Supply", "1,000,000,000 per token"],
  ["Sold on the curve", "800,000,000 (80%)"],
  ["Kept for the Uniswap pool", "200,000,000 (20%), added at graduation, LP burned"],
  ["Platform fee", "1% of every trade, per curve"],
  ["Creator fee", "0% to 1%, chosen at launch, paid to the creator on every trade"],
  ["Slippage guard", "3% default on the site, enforced by the contract"],
  ["Network", "Robinhood Chain mainnet (chain 4663)"],
];

export default function Page() {
  return (
    <div className="mp mp-page">
      <header className="mp-pagehead">
        <p className="mp-eyebrow">How it works</p>
        <h1>A coin for every country, a market for every currency.</h1>
        <p className="mp-lede">mapin turns the world map into a launchpad. Countries are the venues, their currencies are the base pairs, and anyone can launch.</p>
      </header>
      <ol className="mp-steps mp-steps-5">
        {STEPS.map((s) => <li key={s.n}><span>{s.n}</span><h3>{s.t}</h3><p>{s.d}</p></li>)}
      </ol>

      <section className="mp-section">
        <p className="mp-eyebrow">Example</p>
        <h2>Launching $SAHARA on Algeria</h2>
        <div className="mp-flow">
          <div><b>You</b><span>name it Sahara, ticker SAHARA, 0.5% creator fee</span></div>
          <i>→</i>
          <div><b>$DZD</b><span>exists? if not, it is created now, paired with ETH</span></div>
          <i>→</i>
          <div><b>$SAHARA / $DZD</b><span>live on Algeria, on the map, on the Tokens page</span></div>
        </div>
        <p className="mp-sub">A buyer sends 0.01 ETH. The contract buys $DZD with it, then buys $SAHARA with the $DZD, and sends $SAHARA to the buyer. Both curves move, both creators earn their fee.</p>
      </section>

      <section className="mp-section">
        <p className="mp-eyebrow">The numbers</p>
        <h2>Same rules for every token</h2>
        <dl className="mp-facts">{FACTS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>

      <section className="mp-section">
        <p className="mp-eyebrow">Good to know</p>
        <h2>Currency coins are not money</h2>
        <p className="mp-sub">$DZD, $JPY, $GBP and the rest are community meme coins themed on each currency. Their price is set by trading only. They are not stablecoins, not backed by anything and not worth the real currency. The contract has not been audited. Trade only what you can afford to lose.</p>
        <div className="mp-cta"><Link className="btn btn-yellow btn-lg" href="/#map">Open the map</Link><Link className="btn btn-lg" href="/docs">Read the docs</Link></div>
      </section>
    </div>
  );
}
