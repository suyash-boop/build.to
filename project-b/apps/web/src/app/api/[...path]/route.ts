import type { NextRequest } from "next/server";
import { trustedClientIp } from "@/lib/client-ip";

/**
 * Same-origin proxy to the API service. A route handler (not a next.config rewrite) because
 * rewrites are fixed at build time, while API_INTERNAL_URL is runtime configuration.
 */
export const dynamic = "force-dynamic";
// Live updates stream through this proxy. On Vercel a function stops at its duration limit; the
// browser then reconnects on its own, so the cap only bounds how long one stream lives.
export const maxDuration = 300;

// authorization: editor extensions send a device bearer token instead of a cookie. No x-request-id:
// the API assigns its own, so a client cannot plant ids in the logs.
const FORWARD_REQUEST = ["authorization", "cookie", "content-type", "origin", "referer", "user-agent", "accept", "x-hub-signature-256", "x-github-delivery", "x-github-event"];
const DEFAULT_BODY_LIMIT = 1024 * 1024;
// GitHub sends webhook payloads up to 25 MB; nothing else needs more than a megabyte.
const WEBHOOK_BODY_LIMIT = 25 * 1024 * 1024;

/** Read at most `limit` bytes, or null when the body is larger: never buffer an unbounded upload. */
async function readCapped(req: NextRequest, limit: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const api = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";
  const { path } = await ctx.params;
  const target = `${api}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  // One verified address, never the chain the client sent (see lib/client-ip.ts).
  const ip = trustedClientIp((n) => req.headers.get(n));
  if (ip) headers.set("x-forwarded-for", ip);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let body: Uint8Array | undefined;
  if (hasBody) {
    const limit = path.join("/") === "webhooks/github" ? WEBHOOK_BODY_LIMIT : DEFAULT_BODY_LIMIT;
    const read = await readCapped(req, limit);
    if (!read) return Response.json({ error: { code: "payload_too_large", message: "The request body is too large" } }, { status: 413 });
    body = read;
  }
  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: body as BodyInit | undefined,
      redirect: "manual",
      cache: "no-store",
      // A closed tab aborts the upstream request too, so long-lived streams do not leak.
      signal: req.signal,
    });
  } catch {
    return Response.json({ error: { code: "unavailable", message: "The service is temporarily unavailable" } }, { status: 503 });
  }

  const out = new Headers();
  res.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key) && key !== "set-cookie") out.set(key, value);
  });
  // Preserve every Set-Cookie header individually.
  for (const c of res.headers.getSetCookie()) out.append("set-cookie", c);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
