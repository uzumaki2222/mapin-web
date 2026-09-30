export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }} role="status">
      <span className="spinner" aria-hidden />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
