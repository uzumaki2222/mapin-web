import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { toPlace, upsertPlace, upsertUserByWallet } from "@/lib/database/queries";
import { areaAt } from "@/lib/osm/client";
import { handle, readJson, assertSameOrigin } from "@/lib/errors/api";
import { appOrigin, features } from "@/lib/config/server";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const body = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  level: z.enum(["country", "state", "county", "city", "town", "suburb", "neighbourhood"]),
});

/** The area at a clicked map point (country / state / city / town / neighbourhood), stored so it can be tokenized. */
export async function POST(req: Request) {
  return handle("places/at", async () => {
    assertSameOrigin(req, appOrigin());
    await rateLimit(`place-at:${clientIp(req)}`, 60, 60);
    const b = body.parse(await readJson(req));
    const found = await areaAt(b.lat, b.lng, b.level);
    if (!found.place) return NextResponse.json({ place: null, levels: found.levels });
    const session = features().sessions ? await getSession() : null;
    const user = session?.wallet_address ? await upsertUserByWallet(session.wallet_address) : null;
    const row = await upsertPlace(found.place, user?.id ?? null);
    return NextResponse.json({ place: toPlace(row), levels: found.levels });
  });
}
