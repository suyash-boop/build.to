import { cn } from "@/lib/utils";

/**
 * build.to logo mark: "bld.to" set heavy inside a black rounded box (inverts in
 * dark mode), with the ".to" in the brand indigo. In the spirit of dev.to's
 * boxed wordmark but an independent design.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded bg-body px-2 py-1 font-mono text-s font-extrabold leading-none tracking-tight text-body-bg select-none",
        className,
      )}
      aria-label="build.to"
    >
      bld<span className="text-brand">.to</span>
    </span>
  );
}
