const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (n) => ethers.parseEther(String(n));
const b32 = (s) => ethers.encodeBytes32String(s);
const CURVE_SUPPLY = E(800_000_000);

async function fixture() {
  const [owner, fees, alice, bob] = await ethers.getSigners();
  const weth = await (await ethers.getContractFactory("WETH9")).deploy();
  const lp = await (await ethers.getContractFactory("MapinLaunchpad")).deploy(owner.address, fees.address, await weth.getAddress());
  await lp.setPlaces([b32("DZ"), b32("MY"), b32("FR"), b32("DE")], [b32("DZD"), b32("MYR"), b32("EUR"), b32("EUR")]);
  return { lp, weth, owner, fees, alice, bob };
}

const params = (key, symbol, extra = {}) => ({
  key: b32(key), name: extra.name || symbol, symbol, metadataURI: "", creatorFeeBps: extra.fee ?? 50, minMidOut: 0, minTokensOut: 0,
});
const cty = (key, symbol, extra = {}) => [params(key, symbol, extra), extra.curName ?? "", extra.curSymbol ?? ""];
async function launched(lp, tx, event) {
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === event);
  return ethers.getContractAt("LaunchToken", ev.args.token);
}
const dl = async () => (await time.latest()) + 600;

describe("MapinLaunchpad", () => {
  it("country needs its currency first, then pairs with it", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    await expect(lp.connect(alice).launchCountry(...cty("DZ", "ALGERIA"))).to.be.revertedWithCustomError(lp, "CurrencyNotLaunched");
    const dzd = await launched(lp, await lp.connect(alice).launchCurrency(params("DZD", "DZD")), "CurrencyLaunched");
    const dz = await launched(lp, await lp.connect(bob).launchCountry(...cty("DZ", "ALGERIA")), "CountryLaunched");
    expect(await dz.quoteToken()).to.equal(await dzd.getAddress());
    expect(await lp.currencyToken(b32("DZD"))).to.equal(await dzd.getAddress());
    expect(await lp.placeTokens(b32("DZ"))).to.deep.equal([await dz.getAddress()]);
  });

  it("France and Germany share the EUR currency token; one token per place/currency", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    const eur = await launched(lp, await lp.connect(alice).launchCurrency(params("EUR", "EURO")), "CurrencyLaunched");
    const fr = await launched(lp, await lp.connect(alice).launchCountry(...cty("FR", "FRANCE")), "CountryLaunched");
    const de = await launched(lp, await lp.connect(bob).launchCountry(...cty("DE", "GERMANY")), "CountryLaunched");
    expect(await fr.quoteToken()).to.equal(await eur.getAddress());
    expect(await de.quoteToken()).to.equal(await eur.getAddress());
    await expect(lp.connect(bob).launchCurrency(params("EUR", "EUR2"))).to.be.revertedWithCustomError(lp, "AlreadyLaunched");
    const fr2 = await launched(lp, await lp.connect(bob).launchCountry(...cty("FR", "CROISSANT", { name: "Croissant Coin" })), "CountryLaunched");
    expect(await fr2.quoteToken()).to.equal(await eur.getAddress());
    expect(await fr2.name()).to.equal("Croissant Coin");
    expect((await lp.placeTokens(b32("FR"))).length).to.equal(2);
    await expect(lp.connect(bob).launchCurrency(params("XYZ", "XYZ"))).to.be.revertedWithCustomError(lp, "UnknownCurrency");
    await expect(lp.connect(bob).launchCountry(...cty("ZZ", "ZZ"))).to.be.revertedWithCustomError(lp, "UnknownPlace");
  });

  it("buyWithETH on a country routes through its currency, matches preview", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    await lp.connect(alice).launchCurrency(params("MYR", "MYR"));
    const my = await launched(lp, await lp.connect(alice).launchCountry(...cty("MY", "MALAYSIA")), "CountryLaunched");
    const addr = await my.getAddress();
    const [mid, out] = await lp.previewBuyWithETH(addr, E(0.05));
    expect(mid).to.be.gt(0);
    await lp.connect(bob).buyWithETH(addr, mid, out, await dl(), { value: E(0.05) });
    expect(await my.balanceOf(bob.address)).to.equal(out);
  });

  it("sellForETH returns ETH, round trip loses only fees", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    await lp.connect(alice).launchCurrency(params("MYR", "MYR", { fee: 0 }));
    const my = await launched(lp, await lp.connect(alice).launchCountry(...cty("MY", "MALAYSIA", { fee: 0 })), "CountryLaunched");
    const addr = await my.getAddress();
    await lp.connect(bob).buyWithETH(addr, 0, 0, await dl(), { value: E(0.2) });
    const bal = await my.balanceOf(bob.address);
    await my.connect(bob).approve(await lp.getAddress(), bal);
    const [, ethOut] = await lp.previewSellForETH(addr, bal);
    const before = await ethers.provider.getBalance(bob.address);
    const tx = await lp.connect(bob).sellForETH(addr, bal, 0, ethOut, await dl());
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const got = (await ethers.provider.getBalance(bob.address)) - before + gas;
    expect(got).to.equal(ethOut);
    expect(got).to.be.gt((E(0.2) * 95n) / 100n); // 4 x 1% fee ≈ 4% lost
  });

  it("creator fee paid to creator in the quote token", async () => {
    const { lp, weth, alice, bob, fees } = await loadFixture(fixture);
    const dzd = await launched(lp, await lp.connect(alice).launchCurrency(params("DZD", "DZD", { fee: 100 })), "CurrencyLaunched");
    const before = await ethers.provider.getBalance(alice.address);
    await lp.connect(bob).buyWithETH(await dzd.getAddress(), 0, 0, await dl(), { value: E(1) });
    expect(await weth.balanceOf(alice.address)).to.equal(E(0.01)); // 1% creator fee in WETH
    expect(await weth.balanceOf(fees.address)).to.equal(E(0.01)); // 1% platform fee
    expect(await ethers.provider.getBalance(alice.address)).to.equal(before);
  });

  it("direct buy/sell with the quote token works", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    const dzd = await launched(lp, await lp.connect(alice).launchCurrency(params("DZD", "DZD")), "CurrencyLaunched");
    const dz = await launched(lp, await lp.connect(alice).launchCountry(...cty("DZ", "ALGERIA")), "CountryLaunched");
    await lp.connect(bob).buyWithETH(await dzd.getAddress(), 0, 0, await dl(), { value: E(0.5) });
    const cur = await dzd.balanceOf(bob.address);
    await dzd.connect(bob).approve(await lp.getAddress(), cur);
    const [out] = await lp.previewBuy(await dz.getAddress(), cur / 2n);
    await lp.connect(bob).buy(await dz.getAddress(), cur / 2n, out, await dl());
    expect(await dz.balanceOf(bob.address)).to.equal(out);
    await dz.connect(bob).approve(await lp.getAddress(), out);
    const [q] = await lp.previewSell(await dz.getAddress(), out);
    const b0 = await dzd.balanceOf(bob.address);
    await lp.connect(bob).sell(await dz.getAddress(), out, q, await dl());
    expect((await dzd.balanceOf(bob.address)) - b0).to.equal(q);
  });

  it("currency graduates at 800M sold, refunds excess ETH, owner migrates", async () => {
    const { lp, weth, alice, bob, owner } = await loadFixture(fixture);
    const dzd = await launched(lp, await lp.connect(alice).launchCurrency(params("DZD", "DZD", { fee: 0 })), "CurrencyLaunched");
    const addr = await dzd.getAddress();
    const before = await ethers.provider.getBalance(bob.address);
    const rc = await (await lp.connect(bob).buyWithETH(addr, 0, 0, await dl(), { value: E(50) })).wait();
    const spent = before - (await ethers.provider.getBalance(bob.address)) - rc.gasUsed * rc.gasPrice;
    expect(await dzd.balanceOf(bob.address)).to.equal(CURVE_SUPPLY);
    expect(spent).to.be.lt(E(6)); // ~4.4 ETH + 1% fee, rest refunded
    const c = await lp.curves(addr);
    expect(c.graduated).to.equal(true);
    await expect(lp.connect(bob).buyWithETH(addr, 0, 0, await dl(), { value: E(1) })).to.be.revertedWithCustomError(lp, "AlreadyGraduated");
    await lp.connect(owner).migrate(addr, owner.address);
    expect(await weth.balanceOf(owner.address)).to.equal(c.realQuote);
  });

  it("launch with ETH initial buy, and map snapshot", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    await lp.connect(alice).launchCurrency(params("EUR", "EURO"), { value: E(0.1) });
    const fr = await launched(lp, await lp.connect(bob).launchCountry(...cty("FR", "FRANCE"), { value: E(0.05) }), "CountryLaunched");
    expect(await fr.balanceOf(bob.address)).to.be.gt(0);
    const list = await lp.getTokens(2, 0, 100);
    expect(list.length).to.equal(1);
    expect(ethers.decodeBytes32String(list[0].key)).to.equal("FR");
    expect(list[0].priceEth).to.be.gt(0);
    expect(list[0].progressBps).to.be.gt(0);
    expect(list[0].creator).to.equal(bob.address);
    expect(await lp.getTokens(1, 0, 100)).to.have.length(1);
  });

  it("solvency: launchpad holds the quote it owes", async () => {
    const { lp, weth, alice, bob } = await loadFixture(fixture);
    const eur = await launched(lp, await lp.connect(alice).launchCurrency(params("EUR", "EURO")), "CurrencyLaunched");
    const fr = await launched(lp, await lp.connect(alice).launchCountry(...cty("FR", "FRANCE")), "CountryLaunched");
    const de = await launched(lp, await lp.connect(bob).launchCountry(...cty("DE", "GERMANY")), "CountryLaunched");
    for (let i = 0; i < 4; i++) {
      await lp.connect(bob).buyWithETH(await fr.getAddress(), 0, 0, await dl(), { value: E(0.03 + i / 100) });
      await lp.connect(alice).buyWithETH(await de.getAddress(), 0, 0, await dl(), { value: E(0.02 + i / 100) });
    }
    const half = (await fr.balanceOf(bob.address)) / 2n;
    await fr.connect(bob).approve(await lp.getAddress(), half);
    await lp.connect(bob).sellForETH(await fr.getAddress(), half, 0, 0, await dl());
    const lpAddr = await lp.getAddress();
    const ce = await lp.curves(await eur.getAddress());
    expect(await weth.balanceOf(lpAddr)).to.be.gte(ce.realQuote);
    const owedEur = (await lp.curves(await fr.getAddress())).realQuote + (await lp.curves(await de.getAddress())).realQuote;
    const unsold = CURVE_SUPPLY - ce.tokensSold;
    expect(await eur.balanceOf(lpAddr)).to.be.gte(owedEur + unsold + E(200_000_000));
    expect(await ethers.provider.getBalance(lpAddr)).to.equal(0);
  });

  it("launching a country auto-launches its currency coin when names are given", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    const tx = await lp.connect(alice).launchCountry(params("MY", "DURIAN", { name: "Durian Republic" }), "Malaysian Ringgit", "MYR", { value: E(0.02) });
    const rc = await tx.wait();
    const evs = rc.logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
    const cur = evs.find((e) => e.name === "CurrencyLaunched");
    const cty = evs.find((e) => e.name === "CountryLaunched");
    expect(cur.args.code).to.equal(b32("MYR"));
    expect(cty.args.quote).to.equal(cur.args.token);
    expect(await lp.currencyToken(b32("MYR"))).to.equal(cur.args.token);
    const t = await ethers.getContractAt("LaunchToken", cty.args.token);
    expect(await t.balanceOf(alice.address)).to.be.gt(0);
    // second token on Malaysia reuses the same currency coin, names ignored
    const t2 = await launched(lp, await lp.connect(bob).launchCountry(params("MY", "KL"), "x", "y"), "CountryLaunched");
    expect(await t2.quoteToken()).to.equal(cur.args.token);
  });
});
