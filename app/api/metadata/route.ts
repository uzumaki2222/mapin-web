import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWalletSession } from "@/lib/auth/session";
import { getPlaceById } from "@/lib/database/queries";
import { uploadTokenMetadata } from "@/lib/metadata/upload";
import { checkImageMeta, sniffImageType } from "@/lib/metadata/validate";
import { handle, badRequest, assertSameOrigin, notFound } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { marketPath } from "@/lib/validation/normalize";

export const dynamic = "force-dynamic";

const fields = z.object({
  placeId: z.uuid(),
  description: z.string().trim().min(1, "Description is required").max(1000),
  twitter: z.string().trim().max(100).optional().transform((v) => v || null),
  telegram: z.string().trim().max(100).optional().transform((v) => v || null),
});

/** Pins the token logo + metadata JSON. The pinning endpoint is only ever called from here. */
export async function POST(req: Request) {
  return handle("metadata", async () => {
    assertSameOrigin(req, appOrigin());
    const session = await requireWalletSession();
    await rateLimit(`metadata:${session.wallet_address}`, 10, 60 * 60);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw badRequest("Expected multipart form data");
    }
    const f = fields.parse({
      placeId: form.get("placeId"),
      description: form.get("description"),
      twitter: form.get("twitter") ?? undefined,
      telegram: form.get("telegram") ?? undefined,
    });
    const file = form.get("image");
    if (!(file instanceof File)) throw badRequest("A logo image is required");
    const declared = checkImageMeta(file.type, file.size);
    if (declared) throw badRequest(declared);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const real = sniffImageType(bytes);
    if (!real) throw badRequest("The logo file is not a valid PNG, JPEG, WebP or GIF image.");

    // The place page on this site is the token's canonical website: it binds the token to the place.
    const place = await getPlaceById(f.placeId);
    if (!place || place.hidden) throw notFound("Place not found.");
    const website = `${appOrigin().origin}${marketPath(place.slug)}`;
    const cid = await uploadTokenMetadata(
      { bytes, type: real, filename: `logo.${real.split("/")[1]}` },
      { website, twitter: f.twitter, telegram: f.telegram, description: f.description, creator: session.wallet_address },
    );
    return NextResponse.json({ metaCid: cid, website });
  });
}
