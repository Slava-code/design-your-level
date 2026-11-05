"use client";

import { useEffect, useState } from "react";

/** Re-renders every `ms` and returns Date.now() (null on the first render to stay hydration-safe). */
export function useNow(ms = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
