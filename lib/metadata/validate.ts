// Pure image validation shared by the upload form (client) and /api/metadata (server).

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export function checkImageMeta(type: string, size: number): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(type)) return "Logo must be a PNG, JPEG, WebP or GIF image.";
  if (size <= 0) return "Logo file is empty.";
  if (size > MAX_IMAGE_BYTES) return `Logo must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`;
  return null;
}

/** Detect the real image type from magic bytes (do not trust the declared MIME type). */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return "image/webp";
  return null;
}

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;
export const isCid = (v: unknown): v is string => typeof v === "string" && CID_RE.test(v);
