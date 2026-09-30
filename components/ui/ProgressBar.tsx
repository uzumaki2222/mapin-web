export function BondingProgress({ percent, graduated }: { percent: number | null; graduated: boolean }) {
  if (graduated) {
    return (
      <div className="stack" style={{ gap: 4 }}>
        <div className="row between tiny mono"><span className="badge badge-green">Graduated</span><span>Uniswap v4</span></div>
        <div className="progress graduated"><div style={{ width: "100%" }} /></div>
      </div>
    );
  }
  const p = percent ?? 0;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row between tiny mono"><span className="badge badge-yellow">Bonding</span><span>{percent === null ? "—" : `${p.toFixed(2)}%`}</span></div>
      <div className="progress" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Bonding progress">
        <div style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
      </div>
    </div>
  );
}
