import { X_LOGO_PATH, X_URL } from "@/lib/config/social";
import { MAPIN_LAUNCHPAD } from "@/lib/contracts/mapin-abi";
import { EXPLORER_URL, explorerAddress } from "@/lib/config/public";

/** X + contract-on-explorer icon buttons, used in the footer and the menu. */
export function SocialLinks({ size = 40 }: { size?: number }) {
  const explorer = MAPIN_LAUNCHPAD ? explorerAddress(MAPIN_LAUNCHPAD) : EXPLORER_URL;
  return (
    <div className="mp-social">
      <a className="mp-icon" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="mapin on X" style={{ width: size, height: size }}>
        <svg viewBox="0 0 24 24" width={size * 0.45} height={size * 0.45} fill="currentColor" aria-hidden><path d={X_LOGO_PATH} /></svg>
      </a>
      <a className="mp-icon mp-icon-wide" href={explorer} target="_blank" rel="noopener noreferrer" aria-label="mapin factory contract on the explorer" style={{ height: size }}>
        <svg viewBox="0 0 24 24" width={size * 0.45} height={size * 0.45} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 2l8.5 4.9v9.8L12 21.6l-8.5-4.9V6.9L12 2z" /><path d="M3.5 6.9L12 11.8l8.5-4.9M12 11.8v9.8" />
        </svg>
        <span>Factory{MAPIN_LAUNCHPAD ? ` ${MAPIN_LAUNCHPAD.slice(0, 6)}…${MAPIN_LAUNCHPAD.slice(-4)}` : ""}</span>
      </a>
    </div>
  );
}
