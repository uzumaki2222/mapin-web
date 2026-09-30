import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { handle, assertSameOrigin } from "@/lib/errors/api";
import { appOrigin } from "@/lib/config/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle("auth/logout", async () => {
    assertSameOrigin(req, appOrigin());
    await destroySession();
    return NextResponse.json({ ok: true });
  });
}
