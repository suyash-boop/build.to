import { clsx, type ClassValue } from "clsx";
import { differenceInCalendarDays, format, formatDistanceStrict, isThisYear, parseISO } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "4m", "3h", "2d", then "Mar 4", then "Mar 4, 2024". Compact, like a tool, not a sentence. */
export function relativeTime(iso: string, now = new Date()): string {
  const d = parseISO(iso);
  const diffSec = (now.getTime() - d.getTime()) / 1000;
  if (diffSec < 45) return "just now";
  if (diffSec < 7 * 86400) {
    return formatDistanceStrict(d, now, { roundingMethod: "floor" })
      .replace(/ seconds?/, "s")
      .replace(/ minutes?/, "m")
      .replace(/ hours?/, "h")
      .replace(/ days?/, "d");
  }
  return isThisYear(d) ? format(d, "MMM d") : format(d, "MMM d, yyyy");
}

export const fullDate = (iso: string) => format(parseISO(iso), "MMM d, yyyy 'at' HH:mm");
export const shortDate = (iso: string) => (isThisYear(parseISO(iso)) ? format(parseISO(iso), "MMM d") : format(parseISO(iso), "MMM d, yyyy"));
export const monthYear = (iso: string) => format(parseISO(iso), "MMM yyyy");

/**
 * Due date status for calendar dates (YYYY-MM-DD). Client components pass `now` from
 * useNow(), which is null until mount, so server and first client render agree.
 */
export function dueState(date: string | null, now: Date | null = new Date()): "overdue" | "soon" | "later" | null {
  if (!date || !now) return null;
  const days = differenceInCalendarDays(parseISO(date), now);
  if (days < 0) return "overdue";
  if (days <= 3) return "soon";
  return "later";
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** True for absolute http(s) URLs; anything else (javascript:, relative, junk) renders as text. */
export function isHttpUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

export const projectPath = (owner: string, slug: string) => `/${owner}/${slug}`;
