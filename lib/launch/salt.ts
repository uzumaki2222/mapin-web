import { concatHex, getContractAddress, keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { CLONE_INIT_CODE_PREFIX, CLONE_INIT_CODE_SUFFIX, PORTAL_ADDRESS } from "@/lib/contracts/constants";

/** EIP-1167 clone init code for a given implementation (ClonesUpgradeable.cloneDeterministic). */
export function cloneInitCode(tokenImpl: Address): Hex {
  return concatHex([CLONE_INIT_CODE_PREFIX, tokenImpl.toLowerCase() as Hex, `0x${CLONE_INIT_CODE_SUFFIX}`]);
}

/** CREATE2 address the Portal will deploy the token clone at for `salt`. */
export function predictTokenAddress(tokenImpl: Address, salt: Hex, deployer: Address = PORTAL_ADDRESS): Address {
  return getContractAddress({ from: deployer, salt: toBytes(salt), bytecode: cloneInitCode(tokenImpl), opcode: "CREATE2" });
}

export interface SaltResult {
  salt: Hex;
  address: Address;
  iterations: number;
}

/**
 * Vanity salt search (same algorithm as the protocol's reference implementation):
 *   salt0 = keccak256(random 32 bytes); salt_{n+1} = keccak256(salt_n)
 * until the predicted clone address ends with `suffix`.
 * Pure CPU work: run it inside workers/salt-worker.ts so the UI stays responsive.
 */
export function findVanitySalt(
  tokenImpl: Address,
  suffix: string,
  seed: Uint8Array,
  opts: { maxIterations?: number; onProgress?: (iterations: number) => void; progressEvery?: number } = {},
): SaltResult {
  if (!/^[0-9a-f]{4}$/.test(suffix)) throw new Error("Suffix must be exactly 4 lower-case hex characters");
  if (seed.length !== 32) throw new Error("Seed must be 32 bytes");
  const max = opts.maxIterations ?? 5_000_000;
  const every = opts.progressEvery ?? 5_000;
  const initCodeHash = keccak256(cloneInitCode(tokenImpl));
  let salt = keccak256(toHex(seed));
  for (let i = 0; i < max; i++) {
    const address = getContractAddress({ from: PORTAL_ADDRESS, salt: toBytes(salt), bytecodeHash: initCodeHash, opcode: "CREATE2" });
    if (address.toLowerCase().endsWith(suffix)) return { salt, address, iterations: i };
    if (opts.onProgress && i > 0 && i % every === 0) opts.onProgress(i);
    salt = keccak256(salt);
  }
  throw new Error(`No vanity salt found within ${max} iterations`);
}

/**
 * Main-thread fallback used only if Web Workers are unavailable: same search, but yields to the
 * event loop every `chunk` iterations so the page stays responsive.
 */
export async function findVanitySaltAsync(
  tokenImpl: Address,
  suffix: string,
  seed: Uint8Array,
  opts: { onProgress?: (iterations: number) => void; chunk?: number; signal?: AbortSignal; maxIterations?: number } = {},
): Promise<SaltResult> {
  const chunk = opts.chunk ?? 1_500;
  const max = opts.maxIterations ?? 5_000_000;
  const initCodeHash = keccak256(cloneInitCode(tokenImpl));
  let salt = keccak256(toHex(seed));
  for (let i = 0; i < max; i++) {
    const address = getContractAddress({ from: PORTAL_ADDRESS, salt: toBytes(salt), bytecodeHash: initCodeHash, opcode: "CREATE2" });
    if (address.toLowerCase().endsWith(suffix)) return { salt, address, iterations: i };
    salt = keccak256(salt);
    if (i % chunk === 0 && i > 0) {
      opts.onProgress?.(i);
      if (opts.signal?.aborted) throw new Error("Launch cancelled.");
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  throw new Error(`No vanity salt found within ${max} iterations`);
}
