"use client";

import { useState } from "react";
import Link from "next/link";
import { useConnection } from "wagmi";
import { LAUNCH_STEPS, readPendingLaunch, clearPendingLaunch, useLaunch, type LaunchInput, type PendingLaunch } from "@/components/create/useLaunch";
import { Notice } from "@/components/ui/Notice";
import { CopyButton } from "@/components/ui/CopyButton";
import { Logo } from "@/components/ui/Logo";
import { explorerAddress, explorerTx } from "@/lib/config/public";
import { BSC_CHAIN_ID } from "@/lib/contracts/constants";

export function LaunchPanel({ input, onBack }: { input: LaunchInput; onBack: () => void }) {
  const { chainId } = useConnection();
  const { launch, resume, cancel, reset, step, error, detail, result, txHash } = useLaunch();
  // Only rendered client-side after user interaction (step 5), so reading storage here is safe.
  const [pending, setPending] = useState<PendingLaunch | null>(() => (typeof window === "undefined" ? null : readPendingLaunch()));

  const activeIndex = step ? LAUNCH_STEPS.findIndex((s) => s.key === step) : -1;
  const busy = step !== null && step !== "done" && !error;

  if (result) {
    return (
      <div className="live-banner stack" data-testid="market-live">
        <Logo height={36} />
        <h2 style={{ margin: 0 }}>{input.placeName.toUpperCase()} IS ON THE MAP</h2>
        <div>
          <div className="tiny">Token</div>
          <div className="row"><span className="break">{result.tokenAddress}</span><CopyButton value={result.tokenAddress} /></div>
        </div>
        <div>
          <div className="tiny">Transaction</div>
          <div className="row">
            <a className="break" href={explorerTx(result.txHash)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--yellow)" }}>{result.txHash}</a>
          </div>
        </div>
        <div className="row">
          <Link className="btn btn-yellow" href={result.marketPath}>Open market page →</Link>
          <a className="btn" href={explorerAddress(result.tokenAddress)} target="_blank" rel="noopener noreferrer">BscScan ↗</a>
        </div>
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="panel-title">Step 4 — Launch</div>
      {pending && !busy ? (
        <Notice tone="warn" title="Unfinished launch found">
          A launch for {pending.placeName} was sent ({pending.txHash.slice(0, 10)}…) but not confirmed here.
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => resume(pending)}>Resume confirmation</button>
            <a className="btn btn-sm" href={explorerTx(pending.txHash)} target="_blank" rel="noopener noreferrer">View tx ↗</a>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { clearPendingLaunch(null); setPending(null); }}>Dismiss</button>
          </div>
        </Notice>
      ) : null}

      <ul className="progress-list" aria-live="polite">
        {LAUNCH_STEPS.map((s, i) => {
          const state = error && error.step === s.key ? "error" : i < activeIndex || step === "done" ? "done" : i === activeIndex ? "active" : undefined;
          return (
            <li key={s.key} data-state={state}>
              {state === "active" ? <span className="spinner" aria-hidden /> : <span aria-hidden>{state === "done" ? "✓" : state === "error" ? "✕" : "○"}</span>}
              <span>{s.label}</span>
              {state === "active" && detail ? <span className="tiny muted break">{detail}</span> : null}
            </li>
          );
        })}
      </ul>

      {txHash ? (
        <div className="small mono">
          Transaction: <a href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer">{txHash}</a>
        </div>
      ) : null}

      {error ? <Notice tone="error" title="Launch did not complete">{error.message}</Notice> : null}
      {chainId !== BSC_CHAIN_ID ? <Notice tone="warn">Switch your wallet to BNB Smart Chain to launch.</Notice> : null}

      <div className="row between">
        <button type="button" className="btn" disabled={busy} onClick={() => { reset(); onBack(); }}>← Back</button>
        <div className="row">
          {step === "salt" && !error ? <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button> : null}
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy || chainId !== BSC_CHAIN_ID}
            onClick={() => launch(input)}
            data-testid="launch-market"
          >
            {busy ? <span className="spinner" aria-hidden /> : null}
            {error ? "Retry launch" : `Launch $${input.symbol}`}
          </button>
        </div>
      </div>
    </div>
  );
}
