import { isCid } from "@/lib/metadata/validate";
import { ipfsGatewayUrl } from "@/lib/metadata/upload";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/** Same-origin proxy for pinned logos/metadata (keeps the gateway an implementation detail). */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (!isCid(cid)) return new Response("Invalid content id", { status: 400 });
  let upstream: Response;
  try {
    upstream = await fetch(ipfsGatewayUrl(cid), { signal: AbortSignal.timeout(20_000), next: { revalidate: 86_400 } });
  } catch {
    return new Response("Content temporarily unavailable", { status: 502 });
  }
  if (!upstream.ok) return new Response("Content not found", { status: upstream.status === 404 ? 404 : 502 });
  const type = upstream.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type) && type !== "application/json") {
    return new Response("Unsupported content type", { status: 415 });
  }
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return new Response("Content too large", { status: 413 });
  return new Response(buf, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable", // content-addressed
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
