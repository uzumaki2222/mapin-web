import "server-only";
import { z } from "zod";
import { serverEnv, ConfigError } from "@/lib/config/server";
import { ApiError } from "@/lib/errors/api";
import { isCid } from "@/lib/metadata/validate";

// Upload protocol (docs.flap.sh → Launch token through Portal → "Upload metadata"):
// GraphQL multipart request (graphql-multipart-request-spec) with
//   operations = { query: MUTATION_CREATE, variables: { file: null, meta: MetadataInput } }
//   map        = { "0": ["variables.file"] }
//   "0"        = the image file
// Response: { data: { create: "<CID of the metadata JSON>" } }

const MUTATION_CREATE = `
mutation Create($file: Upload!, $meta: MetadataInput!) {
  create(file: $file, meta: $meta)
}
`;

export interface TokenMetaInput {
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  description: string;
  creator: string;
}

const responseSchema = z.object({
  data: z.object({ create: z.string() }).nullable().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

export async function uploadTokenMetadata(image: { bytes: Uint8Array; type: string; filename: string }, meta: TokenMetaInput): Promise<string> {
  const url = serverEnv().METADATA_UPLOAD_URL;
  if (!url) throw new ConfigError("METADATA_UPLOAD_URL is not configured. See README → Metadata.");

  const form = new FormData();
  form.append("operations", JSON.stringify({ query: MUTATION_CREATE, variables: { file: null, meta } }));
  form.append("map", JSON.stringify({ "0": ["variables.file"] }));
  form.append("0", new Blob([image.bytes as BlobPart], { type: image.type }), image.filename);

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(45_000) });
  } catch (err) {
    throw new ApiError(502, "upstream_failed", "Metadata upload failed: the IPFS pinning service is unreachable.", String(err));
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(502, "upstream_failed", `Metadata upload failed (HTTP ${res.status}).`, text.slice(0, 500));
  }
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(text));
  } catch {
    throw new ApiError(502, "upstream_failed", "Metadata upload failed: unexpected response from the pinning service.", text.slice(0, 500));
  }
  if (parsed.errors?.length) {
    throw new ApiError(502, "upstream_failed", `Metadata upload failed: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  const cid = parsed.data?.create;
  if (!isCid(cid)) throw new ApiError(502, "upstream_failed", "Metadata upload failed: no valid CID was returned.", text.slice(0, 500));
  return cid;
}

const metaJsonSchema = z.object({
  image: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
});

/** Read back the pinned metadata JSON (used to verify uploads and to find the image CID). */
export async function fetchTokenMetadata(cid: string): Promise<z.infer<typeof metaJsonSchema> | null> {
  if (!isCid(cid)) return null;
  try {
    const res = await fetch(ipfsGatewayUrl(cid), {
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return metaJsonSchema.parse(await res.json());
  } catch {
    return null;
  }
}

export function ipfsGatewayUrl(cid: string): string {
  const base = serverEnv().IPFS_GATEWAY_URL.replace(/\/?$/, "/");
  return new URL(encodeURIComponent(cid), base).toString();
}
