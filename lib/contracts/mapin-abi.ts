import { parseAbi, type Address } from "viem";
import deployment from "@/lib/contracts/mapin-deployment.json";

/** MapinLaunchpad (contracts/contracts/MapinLaunchpad.sol). Address from env or the deploy script output. */
export const MAPIN_LAUNCHPAD = ((process.env.NEXT_PUBLIC_MAPIN_LAUNCHPAD || deployment.address || "") as string).toLowerCase() as Address | "";
export const MAPIN_START_BLOCK = BigInt(deployment.startBlock || 0);
export const MAPIN_WETH = deployment.weth as Address;

export const KIND_CURRENCY = 1;
export const KIND_COUNTRY = 2;

export const mapinAbi = parseAbi([
  "struct LaunchParams { bytes32 key; string name; string symbol; string metadataURI; uint16 creatorFeeBps; uint256 minMidOut; uint256 minTokensOut; }",
  "function launchCurrency(LaunchParams p) payable returns (address)",
  "function launchCountry(LaunchParams p) payable returns (address)",
  "function buy(address token, uint256 quoteIn, uint256 minTokensOut, uint256 deadline) returns (uint256)",
  "function sell(address token, uint256 tokensIn, uint256 minQuoteOut, uint256 deadline) returns (uint256)",
  "function buyWithETH(address token, uint256 minMidOut, uint256 minTokensOut, uint256 deadline) payable returns (uint256)",
  "function sellForETH(address token, uint256 tokensIn, uint256 minMidOut, uint256 minEthOut, uint256 deadline) returns (uint256)",
  "function previewBuyWithETH(address token, uint256 ethIn) view returns (uint256 midOut, uint256 tokensOut)",
  "function previewSellForETH(address token, uint256 tokensIn) view returns (uint256 midOut, uint256 ethOut)",
  "function previewBuy(address token, uint256 quoteIn) view returns (uint256 tokensOut, uint256 fee, uint256 refund)",
  "function previewSell(address token, uint256 tokensIn) view returns (uint256 quoteOut, uint256 fee)",
  "function spotPriceEth(address token) view returns (uint256)",
  "function currencyToken(bytes32 code) view returns (address)",
  "function tokenByPlace(bytes32 placeId) view returns (address)",
  "function feeBps() view returns (uint256)",
  "function curves(address token) view returns (address quote, address creator, bytes32 key, uint8 kind, uint16 creatorFeeBps, uint64 createdAt, bool graduated, bool migrated, uint256 virtualQuote, uint256 virtualToken, uint256 realQuote, uint256 tokensSold)",
  "function getMapState(uint8 kind, uint256 offset, uint256 limit) view returns (address[] tokens, bytes32[] keys, uint256[] pricesEth, uint256[] progressBps, uint256[] realQuote, bool[] graduated)",
  "event CurrencyLaunched(address indexed token, address indexed creator, bytes32 indexed code, string name, string symbol, string metadataURI, uint16 creatorFeeBps)",
  "event CountryLaunched(address indexed token, address indexed creator, bytes32 indexed placeId, bytes32 currency, address quote, string name, string symbol, string metadataURI, uint16 creatorFeeBps)",
  "event Trade(address indexed token, address indexed trader, bool isBuy, uint256 quoteAmount, uint256 tokenAmount, uint256 platformFee, uint256 creatorFee, uint256 virtualQuote, uint256 virtualToken)",
]);

export const launchTokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function metadataURI() view returns (string)",
  "function creator() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
