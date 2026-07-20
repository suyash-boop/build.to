/**
 * Minimal className joiner. Filters falsy values so conditional classes read
 * cleanly: cn("base", isActive && "active"). Kept local to avoid pulling in
 * clsx/tailwind-merge (not listed in PRD §3).
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
