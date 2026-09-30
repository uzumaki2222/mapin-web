// Web Worker: CREATE2 vanity-salt search off the main thread so the UI never freezes.
import { findVanitySalt } from "@/lib/launch/salt";
import type { Address } from "@/lib/contracts/constants";

export type SaltWorkerRequest = { tokenImpl: Address; suffix: string };
export type SaltWorkerResponse =
  | { type: "progress"; iterations: number }
  | { type: "done"; salt: `0x${string}`; address: Address; iterations: number }
  | { type: "error"; message: string };

const ctx = self as unknown as {
  postMessage(msg: SaltWorkerResponse): void;
  onmessage: ((e: MessageEvent<SaltWorkerRequest>) => void) | null;
};

ctx.onmessage = (e) => {
  const { tokenImpl, suffix } = e.data;
  try {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const r = findVanitySalt(tokenImpl, suffix, seed, {
      progressEvery: 2_000,
      onProgress: (iterations) => ctx.postMessage({ type: "progress", iterations }),
    });
    ctx.postMessage({ type: "done", salt: r.salt, address: r.address, iterations: r.iterations });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
