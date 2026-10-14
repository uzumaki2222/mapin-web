import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { insertUserBusiness, toBusiness, upsertOsmBusiness, upsertUserByWallet } from "@/lib/database/queries";
import { lookupClicked, lookupElement, reverseArea, withArea } from "@/lib/osm/client";
import { parseSourceId } from "@/lib/osm/parse";
import { handle, readJson, assertSameOrigin, badRequest, notFound, unauthorized } from "@/lib/errors/api";
import { appOrigin, features } from "@/lib/config/server";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { websiteDomain } from "@/lib/validation/normalize";

export const dynamic = "force-dynamic";

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const body = z.union([
  z.object({ kind: z.literal("osm"), sourceId: z.string().refine((s) => parseSourceId(s) !== null, "Invalid OSM id") }),
  z.object({ kind: z.literal("click"), lat, lng, label: z.string().trim().max(120).optional() }),
  z.object({
    kind: z.literal("manual"),
    lat,
    lng,
    name: z.string().trim().min(2, "Name is required").max(80),
    category: text(60),
    address: text(200),
    website: text(200).refine((w) => !w || websiteDomain(w) !== null, "Website must be a valid URL"),
  }),
]);

/**
 * Turns what the user picked on the map into a stored business (idempotent):
 *  - osm:    a search result, looked up again on OpenStreetMap (never trusts client-sent details)
 *  - click:  a labelled point on the map, matched to the OpenStreetMap business under the click
 *  - manual: a place that is not on the map yet (wallet sign-in required, rate limited)
 */
export async function POST(req: Request) {
  return handle("businesses/resolve", async () => {
    assertSameOrigin(req, appOrigin());
    await rateLimit(`resolve:${clientIp(req)}`, 60, 60);
    const b = body.parse(await readJson(req));

    if (b.kind === "manual") {
      const session = features().sessions ? await getSession() : null;
      if (!session?.wallet_address) throw unauthorized("Sign in with your wallet to add a business to the map.");
      await rateLimit(`add-business:${session.wallet_address}`, 20, 24 * 60 * 60);
      const user = await upsertUserByWallet(session.wallet_address);
      const area = await reverseArea(b.lat, b.lng);
      const row = await insertUserBusiness(
        { name: b.name, category: b.category, address: b.address, website: b.website, lat: b.lat, lng: b.lng, ...area },
        user.id,
      );
      return NextResponse.json(toBusiness(row));
    }

    const found = b.kind === "osm" ? await lookupElement(b.sourceId) : await lookupClicked(b.lat, b.lng, b.label ?? null);
    if (!found) {
      throw b.kind === "osm"
        ? badRequest("This place is not a business on OpenStreetMap. Use “Add a business” instead.")
        : notFound("No business was found at this spot on the map. Use “Add a business” to put it on the map.");
    }
    const session = features().sessions ? await getSession() : null;
    const user = session?.wallet_address ? await upsertUserByWallet(session.wallet_address) : null;
    const row = await upsertOsmBusiness(await withArea(found), user?.id ?? null);
    return NextResponse.json(toBusiness(row));
  });
}
