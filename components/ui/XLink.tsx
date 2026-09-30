// Link to the mapin account on X. Set NEXT_PUBLIC_X_URL in Vercel (then redeploy).
export const X_URL = (process.env.NEXT_PUBLIC_X_URL ?? "").trim();

export function XIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="#000">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function XLink({ className }: { className?: string }) {
  return (
    <a href={X_URL || undefined} target="_blank" rel="noopener noreferrer" aria-label="mapin on X" className={className}>
      <XIcon />
    </a>
  );
}
