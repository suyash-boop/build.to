/**
 * Returns `next` only when it is a same-origin relative path, else `fallback`.
 * Rejects protocol-relative ("//x"), backslash tricks ("/\x"), and control
 * characters that browsers strip before resolving (e.g. "/\t/evil.com").
 */
export function safeNext(next: unknown, fallback = "/home"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://x");
    if (url.origin !== "http://x") return fallback;
  } catch {
    return fallback;
  }
  return next;
}
