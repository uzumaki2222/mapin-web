import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWalletSession } from "@/lib/auth/session";
import { getBusinessById } from "@/lib/database/queries";
import { fetchTokenMetadata, uploadTokenMetadata } from "@/lib/metadata/upload";
import { checkImageMeta, isCid, sniffImageType } from "@/lib/metadata/validate";
import { handle, badRequest, assertSameOrigin, ApiError, notFound } from "@/lib/errors/api";
import { marketPath } from "@/lib/validation/normalize";
import { appOrigin } from "@/lib/config/server";
import { rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const fields = z.object({
  businessId: z.uuid(),
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
      businessId: form.get("businessId"),
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

    // The business page on this site is the token's canonical website: it binds the token to the place.
    const business = await getBusinessById(f.businessId);
    if (!business || business.hidden) throw notFound("Business not found.");
    const website = `${appOrigin().origin}${marketPath(business.slug)}`;
    const cid = await uploadTokenMetadata(
      { bytes, type: real, filename: `logo.${real.split("/")[1]}` },
      { website, twitter: f.twitter, telegram: f.telegram, description: f.description, creator: session.wallet_address },
    );
    // The logo URL is written into the token on-chain (Pons stores logo/description/socials on the
    // token), so it must be a stable public URL: the content-addressed proxy on this domain.
    let imageCid: string | null = null;
    for (let i = 0; i < 4 && !imageCid; i++) {
      const meta = await fetchTokenMetadata(cid);
      if (meta?.image && isCid(meta.image)) imageCid = meta.image;
      else await new Promise((r) => setTimeout(r, 1_500));
    }
    if (!imageCid) throw new ApiError(502, "upstream_failed", "The logo was uploaded but is not readable from IPFS yet. Retry in a moment.");
    const logoUrl = `${appOrigin().origin}/api/ipfs/${imageCid}`;
    return NextResponse.json({ metaCid: cid, imageCid, logoUrl, website });
  });
}
