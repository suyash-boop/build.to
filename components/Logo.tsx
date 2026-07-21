import { cn } from "@/lib/utils";

/**
 * build.to logo mark: "bld.to" in white, heavy, inside a plain black rounded
 * box. In the spirit of dev.to's boxed wordmark but an independent design.
 * Intentionally fixed black/white in both themes so the mark stays constant.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded bg-black px-2 py-1 font-mono text-s font-extrabold leading-none tracking-tight text-white select-none",
        className,
      )}
      aria-label="build.to"
    >
      bld.to
    </span>
  );
}
