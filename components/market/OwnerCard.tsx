"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import type { ClaimInfo, MarketDetail } from "@/lib/market/types";
import { api } from "@/lib/client/api";
import { useIsSignedIn, useWalletSignIn } from "@/hooks/useSession";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { CopyButton } from "@/components/ui/CopyButton";
import { Notice } from "@/components/ui/Notice";
import { explorerAddress } from "@/lib/config/public";
import { fmtQuote } from "@/lib/format";
import { shortenAddress, websiteDomain } from "@/lib/validation/normalize";

/**
 * What is held for the owner, and the two things a real owner can do: claim it (DNS proof on the
 * business website domain, then an admin review) or ask for the page to be hidden.
 */
export function OwnerCard({ m }: { m: MarketDetail }) {
  const [mode, setMode] = useState<"idle" | "claim" | "report">("idle");
  // Estimate: every indexed trade on the curve pays buyTaxBps of its quote size to the fee recipient.
  const held = (BigInt(m.volumeAll || "0") * BigInt(m.buyTaxBps)) / 10_000n;

  return (
    <div className="owner-card stack">
      <div className="panel-title" style={{ margin: 0 }}>{m.claimed ? "Owner" : "Held for the owner"}</div>
      <div className="owner-held">≈ {fmtQuote(held.toString(), m.quoteDecimals, m.quoteSymbol)}</div>
      <p className="small" style={{ margin: 0 }}>
        {m.buyTaxBps / 100}% of every trade on ${m.symbol} goes to{" "}
        {m.claimed && m.claimedWallet ? (
          <>the verified owner (<a href={explorerAddress(m.claimedWallet)} target="_blank" rel="noopener noreferrer">{shortenAddress(m.claimedWallet)}</a>).</>
        ) : (
          <>the <a href={explorerAddress(m.feeRecipient)} target="_blank" rel="noopener noreferrer">owner escrow</a>, and is paid out when the real owner of {m.businessName} claims it.</>
        )}
      </p>
      {!m.claimed ? (
        mode === "claim" ? (
          <ClaimForm m={m} onClose={() => setMode("idle")} />
        ) : mode === "report" ? (
          <ReportForm businessId={m.businessId} onClose={() => setMode("idle")} />
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => setMode("claim")}>I own this business — claim it</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("report")}>Not okay with this page? Ask us to hide it</button>
          </>
        )
      ) : null}
    </div>
  );
}

function ClaimForm({ m, onClose }: { m: MarketDetail; onClose: () => void }) {
  const { isConnected } = useConnection();
  const signedIn = useIsSignedIn();
  const { signIn, pending: signing, error: signError } = useWalletSignIn();
  const qc = useQueryClient();
  const [domain, setDomain] = useState(websiteDomain(m.website) ?? "");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: ["claim", m.businessId, signedIn],
    queryFn: () => api<{ claim: ClaimInfo | null }>(`/api/claims?businessId=${m.businessId}`),
    enabled: signedIn,
  });
  const claim = mine.data?.claim ?? null;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/claims", { method: "POST", json: { businessId: m.businessId, domain, contact } });
      await qc.invalidateQueries({ queryKey: ["claim", m.businessId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!claim) return;
    setBusy(true);
    setError(null);
    setCheckMsg(null);
    try {
      const r = await api<{ found: boolean }>(`/api/claims/${claim.id}/verify`, { method: "POST" });
      setCheckMsg(r.found ? null : "The record was not found yet. DNS changes can take up to an hour — try again later.");
      await qc.invalidateQueries({ queryKey: ["claim", m.businessId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="stack">
        <p className="small" style={{ margin: 0 }}>Connect the wallet that should receive the owner&apos;s share.</p>
        <ConnectButton />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    );
  }
  if (!signedIn) {
    return (
      <div className="stack">
        <button type="button" className="btn btn-primary" disabled={signing} onClick={() => signIn()}>
          {signing ? <span className="spinner" aria-hidden /> : null} Sign in with this wallet
        </button>
        {signError ? <Notice tone="error">{signError}</Notice> : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    );
  }

  if (claim && claim.status !== "rejected") {
    return (
      <div className="stack">
        {claim.status === "pending" ? (
          <>
            <p className="small" style={{ margin: 0 }}>Add this TXT record in the DNS settings of <strong>{claim.domain}</strong>, then press Check:</p>
            <dl className="review dns-box">
              <dt>Type</dt><dd>TXT</dd>
              <dt>Name</dt><dd className="row" style={{ gap: 6 }}><span className="mono break">{claim.txtName}</span><CopyButton value={claim.txtName} /></dd>
              <dt>Value</dt><dd className="row" style={{ gap: 6 }}><span className="mono break">{claim.txtValue}</span><CopyButton value={claim.txtValue} /></dd>
            </dl>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={check}>
              {busy ? <span className="spinner" aria-hidden /> : null} Check DNS record
            </button>
            {checkMsg ? <Notice tone="warn">{checkMsg}</Notice> : null}
          </>
        ) : claim.status === "dns_verified" ? (
          <Notice tone="info" title="Domain verified">
            Thanks — the DNS record is in place. We review every claim by hand before paying out the held share{claim.domainMatches ? "" : " (your domain is not the website we have on record for this place, so we may contact you for more proof)"}.
          </Notice>
        ) : (
          <Notice tone="info" title="Claim approved">This business is being transferred to your wallet.</Notice>
        )}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        We verify owners through the business&apos;s own website domain. You will add one DNS record — no documents needed.
      </p>
      <div className="field">
        <label className="label" htmlFor="claim-domain">Business website domain</label>
        <input id="claim-domain" className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourbusiness.com" />
      </div>
      <div className="field">
        <label className="label" htmlFor="claim-contact">Email or phone (optional)</label>
        <input id="claim-contact" className="input" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      {claim?.status === "rejected" ? <Notice tone="warn">Your previous claim was not approved. You can try again with another domain.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="row between">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || domain.trim().length < 3} onClick={start}>
          {busy ? <span className="spinner" aria-hidden /> : null} Continue
        </button>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>No website? Ask to hide the page instead, or contact us — we can verify by other means.</p>
    </div>
  );
}

function ReportForm({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/businesses/${businessId}/report`, { method: "POST", json: { reason, contact } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Notice tone="info" title="Request received">We review every request. If you are the owner, we will hide this page from mapin.</Notice>;
  return (
    <div className="stack">
      <div className="field">
        <label className="label" htmlFor="rep-reason">Why should this page be hidden?</label>
        <textarea id="rep-reason" className="textarea" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="I own this business and did not agree to this token." />
      </div>
      <div className="field">
        <label className="label" htmlFor="rep-contact">Email or phone (optional)</label>
        <input id="rep-contact" className="input" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="row between">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 5} onClick={send}>Send request</button>
      </div>
    </div>
  );
}
