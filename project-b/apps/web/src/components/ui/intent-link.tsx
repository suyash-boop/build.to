"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * Prefetches the full route (data + code) the moment the user signals intent: pointer over,
 * keyboard focus, or touch. Pages here are per-user and dynamic, so prefetching every visible
 * link would render dozens of pages nobody opens; intent keeps it to the ones they will.
 */
export function IntentLink({ onMouseEnter, onFocus, onTouchStart, ...props }: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [armed, setArmed] = useState(false);
  const arm = () => setArmed(true);
  return (
    <Link
      {...props}
      prefetch={armed ? true : false}
      onMouseEnter={(e) => {
        arm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        arm();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        arm();
        onTouchStart?.(e);
      }}
    />
  );
}
