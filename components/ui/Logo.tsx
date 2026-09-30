import Image from "next/image";

/** The mapin wordmark (public/mapin-logo.png, the supplied treasure-map artwork). */
export function Logo({ height = 40, priority = false, className }: {
  height?: number;
  priority?: boolean;
  className?: string;
}) {
  const ratio = 1000 / 372;
  return (
    <Image
      src="/mapin-logo.png"
      alt="mapin"
      width={Math.round(height * ratio)}
      height={height}
      priority={priority}
      className={className}
      style={{ height, width: "auto", borderRadius: 4 }}
    />
  );
}
