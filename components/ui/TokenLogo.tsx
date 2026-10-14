import Image from "next/image";

export function TokenLogo({ src, symbol, large = false }: { src: string | null; symbol: string; large?: boolean }) {
  const size = large ? 88 : 48;
  if (!src) {
    return (
      <div className={`token-logo${large ? " token-logo-lg" : ""}`} aria-label={`${symbol} logo`}>
        {symbol.slice(0, 3)}
      </div>
    );
  }
  return (
    <Image src={src} alt={`${symbol} logo`} width={size} height={size} unoptimized className={`token-logo${large ? " token-logo-lg" : ""}`} />
  );
}
