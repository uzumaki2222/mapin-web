import Image from "next/image";

/** The mapin mark (public/mapin-logo.png: yellow map mark on a dark rounded tile, square). */
export function Logo({ height = 40, priority = false, className }: {
  height?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/mapin-logo.png"
      alt="mapin"
      width={height}
      height={height}
      priority={priority}
      className={className}
      style={{ height, width: height }}
    />
  );
}
