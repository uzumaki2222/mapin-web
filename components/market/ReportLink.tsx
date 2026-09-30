"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { Notice } from "@/components/ui/Notice";

/** "Report this page" — offensive or misleading tokens are reviewed on /admin. */
export function ReportLink({ placeId }: { placeId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <span className="small muted">Thanks — we will review it.</span>;
  if (!open) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Report this page</button>;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/places/${placeId}/report`, { method: "POST", json: { reason, contact } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ width: "100%" }}>
      <textarea className="textarea" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is wrong with this token or page?" />
      <input className="input" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email (optional)" />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || reason.trim().length < 5} onClick={send}>Send report</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
