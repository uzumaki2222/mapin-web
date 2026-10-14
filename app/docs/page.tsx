import { MAPIN_LAUNCHPAD, MAPIN_WETH } from "@/lib/contracts/mapin-abi";
import { EXPLORER_URL } from "@/lib/config/public";

export const metadata = { title: "Docs", description: "mapin contracts, functions, fees and parameters on Robinhood Chain." };

const FUNCS = [
  ["launchCountry(params, curName, curSymbol)", "Launch a token on a country (free name and ticker). Creates the currency coin first if it does not exist. Send ETH to make a first buy."],
  ["launchCurrency(params)", "Launch a currency coin on its own, paired with ETH."],
  ["buyWithETH(token, minMid, minOut, deadline)", "Buy any token with ETH. Country tokens route ETH → currency coin → token."],
  ["sellForETH(token, amount, minMid, minEth, deadline)", "Sell any token back to ETH along the same route."],
  ["buy / sell(token, amount, minOut, deadline)", "Trade a token directly against its own quote (the currency coin, or WETH for currency coins)."],
  ["previewBuyWithETH / previewSellForETH", "Read-only quotes used by the site before every trade."],
  ["getTokens(kind, offset, limit)", "Every token with price, curve progress, creator and launch time. kind 1 = currency coins, 2 = country tokens."],
  ["placeTokens(placeId)", "Every token launched on one country."],
];

const PARAMS = [
  ["Total supply", "1,000,000,000 per token, minted once to the launchpad"],
  ["Curve supply", "800,000,000; graduation when all of it is sold"],
  ["LP reserve", "200,000,000, released with the raised quote by migrate() after graduation"],
  ["Curve", "Constant product on virtual reserves (virtualQuote × virtualToken = k)"],
  ["Currency coin start", "1.5 ETH virtual reserve, about 4.4 ETH raised to graduate"],
  ["Country token start", "100M currency coins virtual reserve, about 293M raised to graduate"],
  ["Platform fee", "1% (owner can set up to 2%)"],
  ["Creator fee", "0 to 1%, fixed at launch"],
];

function Addr({ label, value }: { label: string; value: string }) {
  return (
    <div className="mp-addrrow">
      <dt>{label}</dt>
      <dd>{value ? <a href={`${EXPLORER_URL}/address/${value}`} target="_blank" rel="noreferrer" className="mono">{value}</a> : <span className="muted">Deploying soon</span>}</dd>
    </div>
  );
}

export default function Page() {
  return (
    <div className="mp mp-page mp-docs">
      <header className="mp-pagehead">
        <p className="mp-eyebrow">Docs</p>
        <h1>Contracts and rules</h1>
        <p className="mp-lede">Everything the site does goes through one contract on Robinhood Chain. No server holds funds or keys.</p>
      </header>

      <section className="mp-section">
        <h2>Addresses</h2>
        <dl className="mp-addrs">
          <Addr label="Factory (MapinLaunchpad)" value={MAPIN_LAUNCHPAD} />
          <Addr label="WETH (internal: wraps the ETH buyers pay)" value={MAPIN_WETH} />
          <div className="mp-addrrow"><dt>Network</dt><dd>Robinhood Chain mainnet · chain id 4663 · gas in ETH</dd></div>
          <div className="mp-addrrow"><dt>Explorer</dt><dd><a href={EXPLORER_URL} target="_blank" rel="noreferrer">{EXPLORER_URL.replace("https://", "")}</a></dd></div>
        </dl>
      </section>

      <section className="mp-section">
        <h2>Functions</h2>
        <dl className="mp-facts mp-funcs">{FUNCS.map(([k, v]) => <div key={k}><dt className="mono">{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>

      <section className="mp-section">
        <h2>Parameters</h2>
        <dl className="mp-facts">{PARAMS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>

      <section className="mp-section">
        <h2>FAQ</h2>
        <div className="mp-faq">
          <details><summary>Can I launch more than one token on a country?</summary><p>Yes. Any wallet can launch any number of tokens on any country. Each one pairs with that country&apos;s currency coin.</p></details>
          <details><summary>Who creates the currency coin?</summary><p>The first person to launch on a country whose currency has no coin yet. The same transaction creates the currency coin, and that person is its creator and earns its creator fee.</p></details>
          <details><summary>Is $EUR worth one euro?</summary><p>No. Currency coins are themed community coins with a free market price. They are not stablecoins and are not backed by any currency.</p></details>
          <details><summary>What happens at graduation?</summary><p>Trading on the curve stops. The raised quote and the 200M LP reserve move to a DEX pool through migrate(), called by the owner.</p></details>
          <details><summary>Which wallets work?</summary><p>Any EVM wallet (MetaMask, Rabby, OKX, Coinbase Wallet…) or an email login that creates a wallet for you, through Privy. You need a little ETH on Robinhood Chain for gas.</p></details>
          <details><summary>Is the contract audited?</summary><p>Not yet. It is tested, but unaudited. Trade only what you can afford to lose.</p></details>
        </div>
      </section>
    </div>
  );
}
