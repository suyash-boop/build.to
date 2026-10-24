import { isIP } from "node:net";

/**
 * The visitor's IP, as reported by the proxies we run in front of the web app, never as claimed by
 * the visitor. Each trusted proxy (a load balancer, a CDN) appends the address it received the
 * request from to X-Forwarded-For; with TRUSTED_PROXY_HOPS = n, the client is the n-th entry from
 * the right. Entries further left were supplied by the client and are ignored.
 *
 * With no trusted proxy configured (the default), nothing in the request can be trusted, so no IP
 * is forwarded and the API falls back to the connection address.
 */
export function trustedClientIp(get: (name: string) => string | null): string | null {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  if (!Number.isInteger(hops) || hops < 1) return null;
  const chain = (get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = chain[chain.length - hops];
  return candidate && isIP(candidate) ? candidate : null;
}
