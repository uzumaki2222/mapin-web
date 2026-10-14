// Integration test against the REAL Robinhood Chain mainnet contracts (WETH + Uniswap V2), on a local fork.
// Nothing is sent to mainnet. Run: npm run test:fork
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const V2Pair = require("@uniswap/v2-core/build/UniswapV2Pair.json");

const RPC = process.env.MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V2_FACTORY = "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f";
const E = (n) => ethers.parseEther(String(n));
const b32 = (s) => ethers.encodeBytes32String(s);
const params = (key, symbol, name) => ({ key: b32(key), name: name || symbol, symbol, metadataURI: "", creatorFeeBps: 50, minMidOut: 0, minTokensOut: 0 });

describe("Robinhood Chain mainnet fork", function () {
  this.timeout(600_000);
  let lp, owner, alice;

  before(async () => {
    await network.provider.request({ method: "hardhat_reset", params: [{ forking: { jsonRpcUrl: RPC } }] });
    [owner, alice] = await ethers.getSigners();
    lp = await (await ethers.getContractFactory("MapinLaunchpad")).deploy(owner.address, owner.address, WETH, V2_FACTORY);
    await lp.setPlaces([b32("MY")], [b32("MYR")]);
  });

  after(async () => {
    await network.provider.request({ method: "hardhat_reset", params: [] });
  });

  it("launches Upin on Malaysia, paired with MYR, on the real Uniswap V2 factory", async () => {
    const tx = await lp.connect(alice).launchCountry(params("MY", "UPIN", "Upin"), "Malaysian Ringgit", "MYR", { value: E(0.01) });
    const evs = (await tx.wait()).logs.map((l) => { try { return lp.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
    const upinAddr = evs.find((e) => e.name === "CountryLaunched").args.token;
    const myrAddr = evs.find((e) => e.name === "CurrencyLaunched").args.token;
    const upin = await ethers.getContractAt("LaunchToken", upinAddr);
    expect(await upin.quoteToken()).to.equal(myrAddr);
    expect(await upin.balanceOf(alice.address)).to.be.gt(0);

    // graduate MYR with real ETH -> real WETH -> real Uniswap V2 pair
    const deadline = Math.floor(Date.now() / 1000) + 3600 * 24;
    await lp.connect(owner).buyWithETH(myrAddr, 0, 0, deadline, { value: E(10) });
    const c = await lp.curves(myrAddr);
    expect(c.migrated).to.equal(true);
    const pair = new ethers.Contract(c.pair, V2Pair.abi, owner);
    const [r0, r1] = await pair.getReserves();
    expect(r0).to.be.gt(0);
    expect(r1).to.be.gt(0);

    // after graduation: buy Upin with ETH, routed through the real MYR/WETH pool
    const [mid, out] = await lp.previewBuyWithETH(upinAddr, E(0.01));
    expect(mid).to.be.gt(0);
    await lp.connect(alice).buyWithETH(upinAddr, (mid * 98n) / 100n, (out * 98n) / 100n, deadline, { value: E(0.01) });
  });
});
