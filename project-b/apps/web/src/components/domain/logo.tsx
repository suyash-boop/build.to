import { cn } from "@/lib/utils";
import { LETTERS_D, LETTERS_VIEWBOX, MARK_LETTERS_OFFSET, MARK_RADIUS, MARK_SIZE } from "./brand";

/** The square mark: white letters on a black rounded square. For icons and avatars of the brand. */
export function LogoMark({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`} className={cn("shrink-0", className)} aria-hidden>
      <rect width={MARK_SIZE} height={MARK_SIZE} rx={MARK_RADIUS} fill="#000" />
      <path transform={`translate(${MARK_LETTERS_OFFSET.x} ${MARK_LETTERS_OFFSET.y})`} fill="#fff" fillRule="evenodd" d={LETTERS_D} />
    </svg>
  );
}

/**
 * The wordmark in the current text color, so it is crisp on both themes. Used in the app chrome,
 * where a black square on a near-black background would read as a hole.
 */
export function Wordmark({ className, height = 18 }: { className?: string; height?: number }) {
  return (
    <span className={cn("shrink-0 font-extrabold tracking-tight text-fg", className)} style={{ fontSize: height }}>build<span className="text-primary">.to</span></span>
  );
}

export function GithubMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
