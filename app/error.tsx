"use client";

import { useEffect } from "react";
import { Logo } from "@/components/ui/Logo";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error("[mapin] page error", error), [error]);
  return (
    <div className="container section center stack" style={{ alignItems: "center" }}>
      <Logo height={48} />
      <h2>This page failed to load</h2>
      <p className="muted">
        {error.message?.includes("DATABASE_URL")
          ? "The database is not configured. See README → Database."
          : "A server error occurred while rendering this page. Details were written to the server log."}
        {error.digest ? <span className="mono tiny"> (ref {error.digest})</span> : null}
      </p>
      <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
    </div>
  );
}
