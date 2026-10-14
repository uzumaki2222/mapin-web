// Deploys MapinLaunchpad and registers every country with its national currency.
// Writes ../lib/contracts/mapin-deployment.json so the website picks up the address.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const MAINNET_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const b32 = (s) => hre.ethers.encodeBytes32String(s);
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const isMainnet = network.name === "robinhoodMainnet";
  const places = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/places.json"), "utf8"));

  console.log(`Network ${network.name} · deployer ${deployer.address}`);
  console.log(`Balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  let weth = process.env.WETH_ADDRESS || (isMainnet ? MAINNET_WETH : "");
  if (!weth) {
    const w = await (await ethers.getContractFactory("WETH9")).deploy();
    await w.waitForDeployment();
    weth = await w.getAddress();
    console.log(`Test WETH ${weth}`);
  }

  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  const lp = await (await ethers.getContractFactory("MapinLaunchpad")).deploy(deployer.address, feeRecipient, weth);
  await lp.waitForDeployment();
  const address = await lp.getAddress();
  const startBlock = (await lp.deploymentTransaction().wait()).blockNumber;
  console.log(`MapinLaunchpad ${address} (block ${startBlock})`);

  for (const part of chunk(places, 60)) {
    await (await lp.setPlaces(part.map((p) => b32(p.id)), part.map((p) => b32(p.currency)))).wait();
  }
  console.log(`Registered ${places.length} countries`);

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const out = { chainId, address, weth, startBlock };
  const target = path.join(__dirname, "../../lib/contracts/mapin-deployment.json");
  fs.writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), target)} — commit it and redeploy the website.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
