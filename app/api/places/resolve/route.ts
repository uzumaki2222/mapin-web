import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { toPlace, upsertPlace, upsertUserByWallet } from "@/lib/database/queries";
import { lookupPlace } from "@/lib/osm/client";
import { parseSourceId } from "@/lib/osm/parse";
import { handle, readJson, assertSameOrigin, badRequest } from "@/lib/errors/api";
import { appOrigin, features } from "@/lib/config/server";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const body = z.object({ sourceId: z.string().refine((s) => parseSourceId(s) !== null, "Invalid place id") });

/** A search result → stored place (looked up again on OpenStreetMap; client details are never trusted). */
export async function POST(req: Request) {
  return handle("places/resolve", async () => {
    assertSameOrigin(req, appOrigin());
    await rateLimit(`place-resolve:${clientIp(req)}`, 60, 60);
    const b = body.parse(await readJson(req));
    const found = await lookupPlace(b.sourceId);
    if (!found) throw badRequest("This result is not an area that can be tokenized (country, state, city, town, village or neighbourhood).");
    const session = features().sessions ? await getSession() : null;
    const user = session?.wallet_address ? await upsertUserByWallet(session.wallet_address) : null;
    return NextResponse.json(toPlace(await upsertPlace(found, user?.id ?? null)));
  });
}
