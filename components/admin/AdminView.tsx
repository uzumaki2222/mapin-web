"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Notice } from "@/components/ui/Notice";
import { marketPath } from "@/lib/validation/normalize";

interface ReportRow { id: number; reason: string; contact: string | null; created_at: string; place_id: string; name: string; slug: string; hidden: boolean; symbol: string | null }

const KEY = "mapin:admin-token";

/** Reports on token pages. Protected by ADMIN_TOKEN (kept only in this browser tab). */
export function AdminView() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<{ reports: ReportRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(KEY) ?? "");
    } catch {
      /* storage blocked */
    }
  }, []);

  const call = useCallback(async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    return json;
  }, [token]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await call("/api/admin/overview"));
      try {
        sessionStorage.setItem(KEY, token);
      } catch {
        /* storage blocked */
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [call, token]);

  async function act(url: string, body: unknown, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    try {
      await call(url, body);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="container section stack">
      <h1 style={{ fontSize: "2rem", margin: 0 }}>Admin</h1>
      <div className="row">
        <input className="input" style={{ maxWidth: 420 }} type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} />
        <button type="button" className="btn btn-primary" disabled={busy || token.length < 24} onClick={load}>Load</button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data ? (
        <>
          <h2 style={{ margin: "12px 0 0" }}>Reports ({data.reports.length})</h2>
          {data.reports.length === 0 ? <p className="muted">No open reports.</p> : null}
          {data.reports.map((r) => (
            <div key={r.id} className="card stack">
              <strong><Link href={marketPath(r.slug)}>{r.name}</Link>{r.symbol ? ` · $${r.symbol}` : ""}{r.hidden ? " (hidden)" : ""}</strong>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.reason}</p>
              <span className="small muted">{r.contact ?? "no contact"} · {new Date(r.created_at).toLocaleString()}</span>
              <div className="row">
                <button type="button" className="btn btn-danger" onClick={() => act(`/api/admin/places/${r.place_id}`, { hidden: true, reason: "reported" }, `Hide ${r.name} from mapin?`)}>Hide page</button>
                <button type="button" className="btn" onClick={() => act(`/api/admin/places/${r.place_id}`, { hidden: false }, "Keep the page and close the request?")}>Keep & close</button>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
