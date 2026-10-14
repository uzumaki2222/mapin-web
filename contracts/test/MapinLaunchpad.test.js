const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const V2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const V2Pair = require("@uniswap/v2-core/build/UniswapV2Pair.json");

const E = (n) => ethers.parseEther(String(n));
const b32 = (s) => ethers.encodeBytes32String(s);
const hex = (b) => (b.startsWith("0x") ? b : "0x" + b);
const CURVE_SUPPLY = E(800_000_000);
const LP_RESERVE = E(200_000_000);
const DEAD = "0x000000000000000000000000000000000000dEaD";

async function fixture() {
  const [owner, fees, alice, bob, eve] = await ethers.getSigners();
  const weth = await (await ethers.getContractFactory("WETH9")).deploy();
  const v2 = await new ethers.ContractFactory(V2Factory.abi, hex(V2Factory.bytecode), owner).deploy(owner.address);
  const lp = await (await ethers.getContractFactory("MapinLaunchpad")).deploy(owner.address, fees.address, await weth.getAddress(), await v2.getAddress());
  await lp.setPlaces([b32("DZ"), b32("MY"), b32("FR"), b32("DE")], [b32("DZD"), b32("MYR"), b32("EUR"), b32("EUR")]);
  return { lp, weth, v2, owner, fees, alice, bob, eve };
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
const pairOf = (addr, signer) => new ethers.Contract(addr, V2Pair.abi, signer);
async function reservesFor(pair, tokenAddr) {
  const [r0, r1] = await pair.getReserves();
  return (await pair.token0()).toLowerCase() === tokenAddr.toLowerCase() ? [r0, r1] : [r1, r0];
}

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

  it("creates the Uniswap V2 pair token/quote at launch", async () => {
    const { lp, v2, weth, alice } = await loadFixture(fixture);
    const myr = await launched(lp, await lp.connect(alice).launchCurrency(params("MYR", "MYR")), "CurrencyLaunched");
    const upin = await launched(lp, await lp.connect(alice).launchCountry(...cty("MY", "UPIN", { name: "Upin" })), "CountryLaunched");
    expect(await upin.pair()).to.equal(await v2.getPair(await upin.getAddress(), await myr.getAddress()));
    expect(await myr.pair()).to.equal(await v2.getPair(await myr.getAddress(), await weth.getAddress()));
    expect(await upin.pair()).to.not.equal(ethers.ZeroAddress);
    expect((await lp.curves(await upin.getAddress())).pair).to.equal(await upin.pair());
  });

  it("many tokens per country, all on the same currency coin", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    const eur = await launched(lp, await lp.connect(alice).launchCurrency(params("EUR", "EURO")), "CurrencyLaunched");
    const fr = await launched(lp, await lp.connect(alice).launchCountry(...cty("FR", "FRANCE")), "CountryLaunched");
    const de = await launched(lp, await lp.connect(bob).launchCountry(...cty("DE", "GERMANY")), "CountryLaunched");
    const fr2 = await launched(lp, await lp.connect(bob).launchCountry(...cty("FR", "CROISSANT", { name: "Croissant Coin" })), "CountryLaunched");
    for (const t of [fr, de, fr2]) expect(await t.quoteToken()).to.equal(await eur.getAddress());
    expect(await fr2.name()).to.equal("Croissant Coin");
    expect((await lp.placeTokens(b32("FR"))).length).to.equal(2);
    await expect(lp.connect(bob).launchCurrency(params("EUR", "EUR2"))).to.be.revertedWithCustomError(lp, "AlreadyLaunched");
    await expect(lp.connect(bob).launchCurrency(params("XYZ", "XYZ"))).to.be.revertedWithCustomError(lp, "UnknownCurrency");
    await expect(lp.connect(bob).launchCountry(...cty("ZZ", "ZZ"))).to.be.revertedWithCustomError(lp, "UnknownPlace");
  });

  it("launching on a country auto-launches its currency coin", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    const tx = await lp.connect(alice).launchCountry(params("MY", "UPIN", { name: "Upin" }), "Malaysian Ringgit", "MYR", { value: E(0.02) });
    const evs = (await tx.wait()).logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
    const cur = evs.find((e) => e.name === "CurrencyLaunched");
    const c = evs.find((e) => e.name === "CountryLaunched");
    expect(cur.args.code).to.equal(b32("MYR"));
    expect(c.args.quote).to.equal(cur.args.token);
    const t = await ethers.getContractAt("LaunchToken", c.args.token);
    expect(await t.balanceOf(alice.address)).to.be.gt(0);
    const t2 = await launched(lp, await lp.connect(bob).launchCountry(params("MY", "IPIN"), "x", "y"), "CountryLaunched");
    expect(await t2.quoteToken()).to.equal(cur.args.token);
  });

  it("nobody can seed the pair before graduation", async () => {
    const { lp, alice } = await loadFixture(fixture);
    await lp.connect(alice).launchCurrency(params("MYR", "MYR"));
    const upin = await launched(lp, await lp.connect(alice).launchCountry(...cty("MY", "UPIN")), "CountryLaunched");
    await lp.connect(alice).buyWithETH(await upin.getAddress(), 0, 0, await dl(), { value: E(0.05) });
    const bal = await upin.balanceOf(alice.address);
    await expect(upin.connect(alice).transfer(await upin.pair(), bal)).to.be.revertedWithCustomError(upin, "DexNotOpen");
  });

  it("buyWithETH routes through the currency, sellForETH back, round trip loses only fees", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    await lp.connect(alice).launchCurrency(params("MYR", "MYR", { fee: 0 }));
    const my = await launched(lp, await lp.connect(alice).launchCountry(...cty("MY", "MALAYSIA", { fee: 0 })), "CountryLaunched");
    const addr = await my.getAddress();
    const [mid, out] = await lp.previewBuyWithETH(addr, E(0.2));
    await lp.connect(bob).buyWithETH(addr, mid, out, await dl(), { value: E(0.2) });
    expect(await my.balanceOf(bob.address)).to.equal(out);
    await my.connect(bob).approve(await lp.getAddress(), out);
    const [, ethOut] = await lp.previewSellForETH(addr, out);
    const before = await ethers.provider.getBalance(bob.address);
    const rc = await (await lp.connect(bob).sellForETH(addr, out, 0, ethOut, await dl())).wait();
    const got = (await ethers.provider.getBalance(bob.address)) - before + rc.gasUsed * rc.gasPrice;
    expect(got).to.equal(ethOut);
    expect(got).to.be.gt((E(0.2) * 95n) / 100n);
  });

  it("creator fee paid to creator in the quote token", async () => {
    const { lp, weth, alice, bob, fees } = await loadFixture(fixture);
    const dzd = await launched(lp, await lp.connect(alice).launchCurrency(params("DZD", "DZD", { fee: 100 })), "CurrencyLaunched");
    await lp.connect(bob).buyWithETH(await dzd.getAddress(), 0, 0, await dl(), { value: E(1) });
    expect(await weth.balanceOf(alice.address)).to.equal(E(0.01));
    expect(await weth.balanceOf(fees.address)).to.equal(E(0.01));
  });

  it("currency graduates and migrates to its Uniswap pair automatically, LP burned", async () => {
    const { lp, weth, alice, bob } = await loadFixture(fixture);
    const myr = await launched(lp, await lp.connect(alice).launchCurrency(params("MYR", "MYR", { fee: 0 })), "CurrencyLaunched");
    const addr = await myr.getAddress();
    const before = await ethers.provider.getBalance(bob.address);
    const rc = await (await lp.connect(bob).buyWithETH(addr, 0, 0, await dl(), { value: E(50) })).wait();
    const spent = before - (await ethers.provider.getBalance(bob.address)) - rc.gasUsed * rc.gasPrice;
    expect(await myr.balanceOf(bob.address)).to.equal(CURVE_SUPPLY);
    expect(spent).to.be.lt(E(6));
    const c = await lp.curves(addr);
    expect(c.graduated).to.equal(true);
    expect(c.migrated).to.equal(true);
    expect(c.realQuote).to.equal(0);
    expect(await myr.dexOpen()).to.equal(true);
    const pair = pairOf(await myr.pair(), bob);
    const [rTok, rWeth] = await reservesFor(pair, addr);
    expect(rTok).to.equal(LP_RESERVE);
    expect(rWeth).to.be.gt(E(4));
    expect(await pair.balanceOf(DEAD)).to.be.gt(0);
    expect(await weth.balanceOf(await lp.getAddress())).to.equal(0);
    // pool price is close to the final curve price (no cliff at graduation)
    const poolPrice = (rWeth * E(1)) / rTok;
    const curvePrice = (c.virtualQuote * E(1)) / c.virtualToken;
    expect(poolPrice).to.be.gt((curvePrice * 95n) / 100n);
    expect(poolPrice).to.be.lt((curvePrice * 105n) / 100n);
    await expect(lp.migrateToDex(addr)).to.be.revertedWithCustomError(lp, "AlreadyMigrated");
  });

  it("after the currency graduates, country tokens still trade with ETH through the pool", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    const myr = await launched(lp, await lp.connect(alice).launchCurrency(params("MYR", "MYR")), "CurrencyLaunched");
    const upin = await launched(lp, await lp.connect(alice).launchCountry(...cty("MY", "UPIN")), "CountryLaunched");
    await lp.connect(bob).buyWithETH(await myr.getAddress(), 0, 0, await dl(), { value: E(50) });
    expect((await lp.curves(await myr.getAddress())).migrated).to.equal(true);
    // buy currency via pool too
    const [, curOut] = await lp.previewBuyWithETH(await myr.getAddress(), E(0.1));
    expect(curOut).to.be.gt(0);
    await lp.connect(alice).buyWithETH(await myr.getAddress(), 0, (curOut * 99n) / 100n, await dl(), { value: E(0.1) });
    // country token: ETH -> pool -> MYR -> curve -> UPIN
    const [mid, out] = await lp.previewBuyWithETH(await upin.getAddress(), E(0.05));
    expect(mid).to.be.gt(0);
    await lp.connect(alice).buyWithETH(await upin.getAddress(), (mid * 99n) / 100n, (out * 99n) / 100n, await dl(), { value: E(0.05) });
    const bal = await upin.balanceOf(alice.address);
    expect(bal).to.be.gt(0);
    await upin.connect(alice).approve(await lp.getAddress(), bal);
    const [, ethOut] = await lp.previewSellForETH(await upin.getAddress(), bal);
    expect(ethOut).to.be.gt(0);
    await lp.connect(alice).sellForETH(await upin.getAddress(), bal, 0, (ethOut * 99n) / 100n, await dl());
  });

  it("country token graduates into a TOKEN / currency-coin Uniswap pair", async () => {
    const { lp, alice, bob } = await loadFixture(fixture);
    const myr = await launched(lp, await lp.connect(alice).launchCurrency(params("MYR", "MYR")), "CurrencyLaunched");
    const upin = await launched(lp, await lp.connect(alice).launchCountry(...cty("MY", "UPIN", { name: "Upin" })), "CountryLaunched");
    // get plenty of MYR, then fill the UPIN curve directly with MYR
    await lp.connect(bob).buyWithETH(await myr.getAddress(), 0, 0, await dl(), { value: E(3) });
    const myrBal = await myr.balanceOf(bob.address);
    await myr.connect(bob).approve(await lp.getAddress(), myrBal);
    await lp.connect(bob).buy(await upin.getAddress(), myrBal, 0, await dl());
    const c = await lp.curves(await upin.getAddress());
    expect(c.graduated).to.equal(true);
    expect(c.migrated).to.equal(true);
    expect(await upin.balanceOf(bob.address)).to.equal(CURVE_SUPPLY);
    const pair = pairOf(await upin.pair(), bob);
    const [rUpin, rMyr] = await reservesFor(pair, await upin.getAddress());
    expect(rUpin).to.equal(LP_RESERVE);
    expect(rMyr).to.be.gt(E(250_000_000));
    expect(await pair.balanceOf(DEAD)).to.be.gt(0);
    // tokens are freely transferable to the pair now, trading continues via ETH route
    expect(await upin.dexOpen()).to.equal(true);
    const [mid, out] = await lp.previewBuyWithETH(await upin.getAddress(), E(0.01));
    await lp.connect(alice).buyWithETH(await upin.getAddress(), (mid * 99n) / 100n, (out * 99n) / 100n, await dl(), { value: E(0.01) });
    expect(await upin.balanceOf(alice.address)).to.be.gt(0);
    const list = await lp.getTokens(2, 0, 10);
    expect(list[0].migrated).to.equal(true);
    expect(list[0].pair).to.equal(await upin.pair());
    expect(list[0].priceEth).to.be.gt(0);
  });

  it("donating to the pair before graduation cannot block migration", async () => {
    const { lp, weth, alice, eve } = await loadFixture(fixture);
    const myr = await launched(lp, await lp.connect(alice).launchCurrency(params("MYR", "MYR")), "CurrencyLaunched");
    const pairAddr = await myr.pair();
    await weth.connect(eve).deposit({ value: E(1) });
    await weth.connect(eve).transfer(pairAddr, E(1));
    await pairOf(pairAddr, eve).sync();
    await lp.connect(alice).buyWithETH(await myr.getAddress(), 0, 0, await dl(), { value: E(50) });
    const c = await lp.curves(await myr.getAddress());
    expect(c.migrated).to.equal(true);
  });

  it("slippage, deadline, migrate guards and owner-only admin", async () => {
    const { lp, alice } = await loadFixture(fixture);
    const dzd = await launched(lp, await lp.connect(alice).launchCurrency(params("DZD", "DZD")), "CurrencyLaunched");
    const a = await dzd.getAddress();
    const [, out] = await lp.previewBuyWithETH(a, E(0.01));
    await expect(lp.connect(alice).buyWithETH(a, 0, out + 1n, await dl(), { value: E(0.01) })).to.be.revertedWithCustomError(lp, "Slippage");
    await expect(lp.connect(alice).buyWithETH(a, 0, 0, (await time.latest()) - 1, { value: E(0.01) })).to.be.revertedWithCustomError(lp, "Expired");
    await expect(lp.migrateToDex(a)).to.be.revertedWithCustomError(lp, "NotGraduated");
    await expect(lp.autoMigrate(a)).to.be.revertedWithCustomError(lp, "OnlySelf");
    await expect(lp.connect(alice).setPlaces([b32("JP")], [b32("JPY")])).to.be.reverted;
    await expect(lp.connect(alice).pause()).to.be.reverted;
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
    expect(await eur.balanceOf(lpAddr)).to.be.gte(owedEur + (CURVE_SUPPLY - ce.tokensSold) + LP_RESERVE);
    expect(await ethers.provider.getBalance(lpAddr)).to.equal(0);
  });
});
