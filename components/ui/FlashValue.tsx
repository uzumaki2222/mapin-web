"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Shows a value and briefly highlights it whenever it changes (e.g. live volume). */
export function FlashValue({ value, children }: { value: string; children: ReactNode }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(t);
  }, [value]);
  return <span className={flash ? "flash" : undefined}>{children}</span>;
}
