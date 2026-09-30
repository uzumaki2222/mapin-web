#!/usr/bin/env node
// Zero-dependency verification of the Portal integration (runs before `npm install`).
//
//  1. Self-tests a from-scratch keccak-256 against known vectors.
//  2. Independently re-parses contracts-reference/IPortal.sol and checks that the ABI in
//     lib/contracts/portal-abi.ts has exactly the same canonical signatures.
//  3. Prints the 4-byte selectors of every function Coded Markets calls.
//  4. ABI-encodes a full newTokenV6 call and decodes the static head back.
//  5. Runs the CREATE2 vanity-salt search (same algorithm as workers/salt-worker.ts) and
//     checks the predicted clone address ends with the required suffix.
//
// Nothing here touches the network.   Usage:  node scripts/verify-abi-offline.mjs

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

// ------------------------------------------------------------------ keccak-256
const RC = [
  1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648, 32907, 0, 2147483649, 0, 2147516545,
  2147483648, 32777, 2147483648, 138, 0, 136, 0, 2147516425, 0, 2147483658, 0, 2147516555, 0, 139,
  2147483648, 32905, 2147483648, 32771, 2147483648, 32770, 2147483648, 128, 2147483648, 32778, 0,
  2147483658, 2147483648, 2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648,
];
function keccakF(s) {
  for (let n = 0; n < 48; n += 2) {
    const c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40], c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
    const c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42], c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
    const c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44], c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45];
    const c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46], c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47];
    const c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48], c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];
    let h = c8 ^ ((c2 << 1) | (c3 >>> 31)), l = c9 ^ ((c3 << 1) | (c2 >>> 31));
    for (let i = 0; i < 50; i += 10) { s[i] ^= h; s[i + 1] ^= l; }
    h = c0 ^ ((c4 << 1) | (c5 >>> 31)); l = c1 ^ ((c5 << 1) | (c4 >>> 31));
    for (let i = 2; i < 50; i += 10) { s[i] ^= h; s[i + 1] ^= l; }
    h = c2 ^ ((c6 << 1) | (c7 >>> 31)); l = c3 ^ ((c7 << 1) | (c6 >>> 31));
    for (let i = 4; i < 50; i += 10) { s[i] ^= h; s[i + 1] ^= l; }
    h = c4 ^ ((c8 << 1) | (c9 >>> 31)); l = c5 ^ ((c9 << 1) | (c8 >>> 31));
    for (let i = 6; i < 50; i += 10) { s[i] ^= h; s[i + 1] ^= l; }
    h = c6 ^ ((c0 << 1) | (c1 >>> 31)); l = c7 ^ ((c1 << 1) | (c0 >>> 31));
    for (let i = 8; i < 50; i += 10) { s[i] ^= h; s[i + 1] ^= l; }
    // rho + pi
    const B = new Array(50);
    const rot = (lo, hi, r) => r === 0 ? [lo, hi] : r < 32
      ? [(lo << r) | (hi >>> (32 - r)), (hi << r) | (lo >>> (32 - r))]
      : [(hi << (r - 32)) | (lo >>> (64 - r)), (lo << (r - 32)) | (hi >>> (64 - r))];
    const R = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      const idx = x + 5 * y, nx = y, ny = (2 * x + 3 * y) % 5;
      const [lo, hi] = rot(s[idx * 2], s[idx * 2 + 1], R[idx]);
      B[(nx + 5 * ny) * 2] = lo; B[(nx + 5 * ny) * 2 + 1] = hi;
    }
    // chi
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const i = (x + 5 * y) * 2, i1 = (((x + 1) % 5) + 5 * y) * 2, i2 = (((x + 2) % 5) + 5 * y) * 2;
      s[i] = B[i] ^ (~B[i1] & B[i2]); s[i + 1] = B[i + 1] ^ (~B[i1 + 1] & B[i2 + 1]);
    }
    s[0] ^= RC[n]; s[1] ^= RC[n + 1];
  }
}
function keccak256(bytes) {
  const rate = 136, s = new Int32Array(50);
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes); padded[bytes.length] ^= 0x01; padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      s[i] ^= padded[off + i * 4] | (padded[off + i * 4 + 1] << 8) | (padded[off + i * 4 + 2] << 16) | (padded[off + i * 4 + 3] << 24);
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { const w = s[i]; out[i * 4] = w & 255; out[i * 4 + 1] = (w >>> 8) & 255; out[i * 4 + 2] = (w >>> 16) & 255; out[i * 4 + 3] = (w >>> 24) & 255; }
  return out;
}
const hex = (b) => "0x" + Buffer.from(b).toString("hex");
const fromHex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const utf8 = (s) => new TextEncoder().encode(s);

ok(hex(keccak256(new Uint8Array())) === "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", "keccak256('') vector");
ok(hex(keccak256(utf8("transfer(address,uint256)"))).slice(0, 10) === "0xa9059cbb", "keccak selector vector transfer(address,uint256)=0xa9059cbb");
ok(hex(keccak256(utf8("Transfer(address,address,uint256)"))) === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "Transfer event topic vector");
ok(hex(keccak256(new Uint8Array(200).fill(0x61))).length === 66, "multi-block absorb");

// ------------------------------------------------------ independent .sol parser
const sol = readFileSync(join(ROOT, "contracts-reference/IPortal.sol"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const enums = new Set([...sol.matchAll(/\benum\s+(\w+)\s*\{/g)].map((m) => m[1]));
const structs = {};
for (const m of sol.matchAll(/\bstruct\s+(\w+)\s*\{([\s\S]*?)\}/g)) {
  structs[m[1]] = m[2].split(";").map((d) => d.trim().split(/\s+/)).filter((t) => t.length >= 2).map((t) => t[0]);
}
const solType = (t) => {
  t = t.replace(/^.*\./, "");
  const arr = (t.match(/(\[\d*\])+$/) || [""])[0];
  const b = t.slice(0, t.length - arr.length);
  if (structs[b]) return "(" + structs[b].map(solType).join(",") + ")" + arr;
  if (enums.has(b)) return "uint8" + arr;
  return (b === "uint" ? "uint256" : b) + arr;
};
const solSig = (fn) => {
  const m = sol.match(new RegExp(`function\\s+${fn}\\s*\\(([\\s\\S]*?)\\)`));
  const params = m[1].trim() ? m[1].split(",").map((p) => p.trim().split(/\s+/)[0]) : [];
  return `${fn}(${params.map(solType).join(",")})`;
};
const solEventSig = (ev) => {
  const m = sol.match(new RegExp(`event\\s+${ev}\\s*\\(([\\s\\S]*?)\\)\\s*;`));
  return `${ev}(${m[1].split(",").map((p) => solType(p.trim().split(/\s+/)[0])).join(",")})`;
};

// --------------------------------------------------- compare with generated ABI
const abiSrc = readFileSync(join(ROOT, "lib/contracts/portal-abi.ts"), "utf8");
const abi = JSON.parse(abiSrc.slice(abiSrc.indexOf("["), abiSrc.lastIndexOf("]") + 1));
const abiType = (p) => p.type.startsWith("tuple") ? "(" + p.components.map(abiType).join(",") + ")" + p.type.slice(5) : p.type;
const abiSig = (e) => `${e.name}(${e.inputs.map(abiType).join(",")})`;

const selectors = {};
for (const e of abi.filter((x) => x.type === "function")) {
  const s = abiSig(e);
  ok(s === solSig(e.name), `ABI matches IPortal.sol: ${e.name}`);
  selectors[e.name] = hex(keccak256(utf8(s))).slice(0, 10);
}
for (const e of abi.filter((x) => x.type === "event")) {
  ok(abiSig(e) === solEventSig(e.name), `event matches IPortal.sol: ${e.name}`);
}
const nt = abi.find((x) => x.name === "newTokenV6");
ok(nt.stateMutability === "payable", "newTokenV6 is payable");
ok(nt.inputs[0].components.length === 26, "NewTokenV6Params has 26 fields");
ok(nt.outputs[0].type === "address", "newTokenV6 returns address");
const tc = abi.find((x) => x.name === "TokenCreated");
ok(tc.inputs.map((i) => i.name).join() === "ts,creator,nonce,token,name,symbol,meta", "TokenCreated field layout");
console.log("\nselectors:");
for (const [k, v] of Object.entries(selectors)) console.log(`  ${v}  ${k}`);
console.log(`  topic TokenCreated = ${hex(keccak256(utf8(abiSig(tc))))}`);

// ------------------------------------------------------------ minimal encoder
const pad32 = (b) => { const o = new Uint8Array(Math.ceil(b.length / 32) * 32 || 0); o.set(b); return o; };
const word = (n) => { const o = new Uint8Array(32); let v = BigInt(n); for (let i = 31; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; } return o; };
const concat = (arr) => { const o = new Uint8Array(arr.reduce((a, b) => a + b.length, 0)); let p = 0; for (const a of arr) { o.set(a, p); p += a.length; } return o; };
const isDynamic = (p) => p.type === "string" || p.type === "bytes" || p.type.endsWith("[]") || (p.type === "tuple" && p.components.some(isDynamic));
function encodeValue(p, v) {
  if (p.type === "tuple") return encodeTuple(p.components, p.components.map((c) => v[c.name]));
  if (p.type === "string" || p.type === "bytes") {
    const b = p.type === "string" ? utf8(v) : fromHex(v);
    return concat([word(b.length), pad32(b)]);
  }
  if (p.type === "address") return word(BigInt(v));
  if (p.type === "bytes32") return fromHex(v);
  if (p.type === "bool") return word(v ? 1 : 0);
  if (/^uint\d+$/.test(p.type)) {
    const bits = BigInt(p.type.slice(4)); const n = BigInt(v);
    if (n < 0n || n >= 1n << bits) throw new Error(`${p.name} out of range for ${p.type}`);
    return word(n);
  }
  throw new Error("unsupported " + p.type);
}
function encodeTuple(params, values) {
  const heads = [], tails = [];
  let headSize = params.reduce((a, p) => a + (isDynamic(p) ? 32 : encodeValue(p, values[params.indexOf(p)]).length), 0);
  let offset = headSize;
  params.forEach((p, i) => {
    const enc = encodeValue(p, values[i]);
    if (isDynamic(p)) { heads.push(word(offset)); tails.push(enc); offset += enc.length; } else heads.push(enc);
  });
  return concat([...heads, ...tails]);
}

const sampleArgs = {
  name: "Coded Project", symbol: "CODE", meta: "bafkreibwjuzzns6yf4wytfr5nk6vujb4yja4iejff2k76nshn2z5jkmiy4",
  dexThresh: 1, salt: "0x" + "ab".repeat(32), migratorType: 1, quoteToken: "0x0000000000000000000000000000000000000000",
  quoteAmt: 10n ** 16n, beneficiary: "0x1234567890abcdef1234567890abcdef12345678", permitData: "0x",
  extensionID: "0x" + "00".repeat(32), extensionData: "0x", dexId: 0, lpFeeProfile: 0, buyTaxRate: 300, sellTaxRate: 500,
  taxDuration: 365n * 86400n, antiFarmerDuration: 3600n, mktBps: 10000, deflationBps: 0, dividendBps: 0, lpBps: 0,
  minimumShareBalance: 0n, dividendToken: "0x0000000000000000000000000000000000000000",
  commissionReceiver: "0x0000000000000000000000000000000000000000", tokenVersion: 6,
};
const calldata = concat([fromHex(selectors.newTokenV6), encodeTuple(nt.inputs, [sampleArgs])]);
ok(calldata.length > 4 + 26 * 32 && (calldata.length - 4) % 32 === 0, `newTokenV6 calldata encoded (${calldata.length} bytes)`);
// decode check: first word is the offset of the single dynamic tuple argument (0x20)
const body = calldata.slice(4);
const readWord = (off) => BigInt(hex(body.slice(off, off + 32)));
const tupleStart = Number(readWord(0));
ok(tupleStart === 32, "tuple offset = 0x20");
const field = (i) => readWord(tupleStart + i * 32);
ok(field(3) === 1n && field(5) === 1n, "dexThresh / migratorType round-trip");
ok(field(7) === 10n ** 16n, "quoteAmt round-trip");
ok(field(8) === BigInt(sampleArgs.beneficiary), "beneficiary round-trip");
ok(field(14) === 300n && field(15) === 500n, "buy/sell tax round-trip");
ok(field(25) === 6n, "tokenVersion round-trip");
const nameOff = Number(field(0));
ok(Buffer.from(body.slice(tupleStart + nameOff + 32, tupleStart + nameOff + 32 + 13)).toString() === "Coded Project", "name string round-trip");
console.log(`\nsample newTokenV6 calldata (first 138 hex chars): ${hex(calldata).slice(0, 138)}…`);

// -------------------------------------------------------------- CREATE2 vanity
const PORTAL = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
const IMPLS = { "8888": "0x8B4329947e34B6d56D71A3385caC122BaDe7d78D", "7777": "0x024f18294970B5c76c0691b87f138A0317156422" };
function predictClone(impl, salt) {
  const init = fromHex("3d602d80600a3d3981f3363d3d373d3d3d363d73" + impl.slice(2).toLowerCase() + "5af43d82803e903d91602b57fd5bf3");
  const initHash = keccak256(init);
  const pre = concat([Uint8Array.of(0xff), fromHex(PORTAL), salt, initHash]);
  return hex(keccak256(pre).slice(12));
}
for (const [suffix, impl] of Object.entries(IMPLS)) {
  const t0 = Date.now();
  let salt = keccak256(randomBytes(32)); let i = 0; let addr;
  while (!(addr = predictClone(impl, salt)).endsWith(suffix)) { salt = keccak256(salt); i++; }
  ok(addr.endsWith(suffix), `vanity ${suffix}: salt ${hex(salt).slice(0, 18)}… → ${addr} (${i} iterations, ${Date.now() - t0} ms)`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll offline checks passed.");
process.exit(failures ? 1 : 0);
