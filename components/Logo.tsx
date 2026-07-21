import { cn } from "@/lib/utils";

/**
 * build.to wordmark: "b." set heavy in a rounded square. In the spirit of
 * dev.to's boxed "DEV" mark but an independent design — black square in light
 * mode, inverts in dark. Uses the brand indigo as the accent dot.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 select-none",
        className,
      )}
      aria-label="build.to"
    >
      <span className="flex size-8 items-center justify-center rounded-large bg-body font-mono text-l font-extrabold leading-none tracking-tight text-body-bg">
        b<span className="text-brand">.</span>
      </span>
      <span className="text-l font-extrabold tracking-tight text-body">
        build<span className="text-brand">.to</span>
      </span>
    </span>
  );
}
