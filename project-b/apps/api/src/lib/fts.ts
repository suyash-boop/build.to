import type { Highlight } from "@bldt/contracts";

/**
 * Turn what someone typed into a safe Postgres tsquery: words only (letters, digits, underscore),
 * all required, each matched as a prefix so results appear while typing ("auth midd" finds
 * "auth middleware"). No operators from user input ever reach to_tsquery.
 */
export function toPrefixQuery(input: string): string | null {
  const words = input.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const unique = [...new Set(words.filter((w) => w.length > 0))].slice(0, 8);
  if (unique.length === 0) return null;
  return unique.map((w) => `${w}:*`).join(" & ");
}

/** ts_headline marks matches with these control characters; they never occur in real text. */
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";
export const HEADLINE_OPTIONS = `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=26, MinWords=10, ShortWord=2, MaxFragments=1, HighlightAll=false`;

/**
 * Split a headline into alternating plain and matched parts. The client renders matched parts in
 * <mark> as text nodes, so highlighting never involves HTML.
 */
export function toHighlight(headline: string | null | undefined): Highlight {
  if (!headline) return [];
  const out: string[] = [];
  let rest = headline.replace(/\s+/g, " ").trim();
  for (;;) {
    const s = rest.indexOf(MARK_START);
    if (s < 0) {
      out.push(rest);
      break;
    }
    const e = rest.indexOf(MARK_END, s);
    if (e < 0) {
      out.push(rest.replaceAll(MARK_START, ""));
      break;
    }
    out.push(rest.slice(0, s), rest.slice(s + 1, e));
    rest = rest.slice(e + 1);
  }
  // A headline with no match at all is noise (ts_headline returns the start of the text).
  return out.length > 1 ? out : [];
}
