import "server-only";
import { resolveTxt } from "node:dns/promises";

import { TXT_PREFIX, txtName } from "@/lib/claims/info";

/** True when `_mapin.<domain>` has a TXT record `mapin-verify=<token>`. */
export async function hasVerificationRecord(domain: string, token: string): Promise<boolean> {
  try {
    const records = await resolveTxt(txtName(domain));
    return records.some((chunks) => chunks.join("").trim() === `${TXT_PREFIX}${token}`);
  } catch {
    return false; // NXDOMAIN / no TXT yet
  }
}
