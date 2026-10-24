"use client";

import { useEffect, useState } from "react";
import { fullDate, relativeTime, shortDate } from "@/lib/utils";

/**
 * Relative timestamps differ between server render and hydration. Render the absolute
 * short form first, then switch to relative after mount, and refresh every minute.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} title={fullDate(iso)} className={className} suppressHydrationWarning>
      {now ? relativeTime(iso, now) : shortDate(iso)}
    </time>
  );
}
