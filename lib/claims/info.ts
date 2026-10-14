import type { ClaimInfo } from "../market/types.ts";

export const TXT_PREFIX = "mapin-verify=";

/** DNS name the owner puts the TXT record on. */
export const txtName = (domain: string) => `_mapin.${domain}`;

export interface ClaimRow { id: string; domain: string; domain_matches: boolean; token: string; status: ClaimInfo["status"] }

export const toClaimInfo = (r: ClaimRow): ClaimInfo => ({
  id: r.id, domain: r.domain, domainMatches: r.domain_matches, txtName: txtName(r.domain), txtValue: `${TXT_PREFIX}${r.token}`, status: r.status,
});
