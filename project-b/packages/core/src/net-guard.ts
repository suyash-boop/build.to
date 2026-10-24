import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Server-side request forgery guard for user-supplied URLs (outbound webhooks). A URL is only
 * delivered to if every address its host resolves to is publicly routable, and the caller then
 * connects to the vetted address itself, so a DNS answer cannot change between check and use.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 96], // unspecified, loopback, and deprecated IPv4-compatible (::a.b.c.d)
  ["::ffff:0:0:0", 96], // SIIT translated addresses
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 can tunnel to private IPv4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // deprecated site-local
  ["ff00::", 8], // multicast
] as const) blocked.addSubnet(net, prefix, "ipv6");

/** IPv4 embedded in an IPv6 address (mapped ::ffff:a.b.c.d, or NAT64 64:ff9b::/96). */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2]!, 16);
  const lo = parseInt(m[3]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, "ipv4");
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return isPublicAddress(v4);
    return !blocked.check(ip, "ipv6");
  }
  return false;
}

/** The host could not be resolved right now. Unlike UnsafeUrlError, worth retrying. */
export class DnsLookupError extends Error {
  override name = "DnsLookupError";
}

export class UnsafeUrlError extends Error {
  override name = "UnsafeUrlError";
}

export interface VettedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export interface GuardOptions {
  /** Development only: allow http and private addresses (a local receiver). */
  allowPrivate?: boolean;
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
}

const defaultResolve = (host: string) => lookup(host, { all: true, verbatim: true });

/** Parse and vet a URL without resolving it: shape checks only. Throws UnsafeUrlError. */
export function parseWebhookUrl(raw: string, opts: GuardOptions = {}): URL {
  if (raw.length > 2048) throw new UnsafeUrlError("The URL is too long");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Enter a full URL, starting with https://");
  }
  if (url.protocol !== "https:" && !(opts.allowPrivate && url.protocol === "http:")) throw new UnsafeUrlError("Webhook URLs must use https");
  if (url.username || url.password) throw new UnsafeUrlError("Put credentials in the path or a query parameter, not before the host");
  if (!url.hostname) throw new UnsafeUrlError("The URL has no host");
  // Standard web ports only: a webhook is not a way to probe arbitrary services on a host.
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!opts.allowPrivate && port !== 443 && port !== 80 && port !== 8443) throw new UnsafeUrlError("Use the standard https port (443, or 8443)");
  url.hash = "";
  return url;
}

/** Resolve and vet. Every resolved address must be public; one private answer rejects the host. */
export async function vetWebhookUrl(raw: string, opts: GuardOptions = {}): Promise<VettedTarget> {
  const url = parseWebhookUrl(raw, opts);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let answers: { address: string; family: number }[];
  if (isIP(host)) answers = [{ address: host, family: isIP(host) }];
  else {
    try {
      answers = await (opts.resolve ?? defaultResolve)(host);
    } catch {
      // Resolver hiccups (SERVFAIL, timeouts) are transient; retry rather than give up on the endpoint.
      throw new DnsLookupError(`${host} could not be resolved right now`);
    }
  }
  if (answers.length === 0) throw new DnsLookupError(`${host} does not resolve`);
  if (!opts.allowPrivate) {
    const bad = answers.find((a) => !isPublicAddress(a.address));
    if (bad) throw new UnsafeUrlError(`${host} points to a private or reserved address`);
  }
  const first = answers[0]!;
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}
