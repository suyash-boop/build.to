"use client";

import { useEffect, useState } from "react";

/**
 * The current time, but only after mount. The server's clock and timezone differ
 * from the viewer's, so anything derived from "now" (due colouring, Today/Yesterday)
 * renders a neutral value on the server and the real one after hydration.
 */
export function useNow(refreshMs?: number): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    if (!refreshMs) return;
    const t = setInterval(() => setNow(new Date()), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);
  return now;
}
