import type { User } from "@bldt/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { generateToken, sha256 } from "../lib/crypto.ts";
import { forbidden, unauthorized } from "../lib/errors.ts";

export const SESSION_COOKIE = "bldt_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
/** Extend a session when less than this much lifetime remains. */
const SLIDE_THRESHOLD_MS = 15 * 24 * 3600 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Device sessions (editor extensions) last longer and carry a recognisable prefix. */
export const DEVICE_SESSION_TTL_MS = 90 * 24 * 3600 * 1000;
export const BEARER_PREFIX = "bldt_";
/** Unauthenticated endpoints a device calls before it has a token. */
const DEVICE_PUBLIC = new Set(["/auth/device/code", "/auth/device/token"]);

export const authPlugin = fp(async (app: FastifyInstance) => {
  const { db, env } = app.deps;
  const webOrigin = new URL(env.WEB_ORIGIN).origin;

  app.decorateRequest("viewer", null);
  app.decorateRequest("sessionId", null);
  app.decorateRequest("sessionKind", null);

  app.addHook("onRequest", async (req, reply) => {
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;

    // CSRF: session cookies are SameSite=Lax; additionally require state-changing requests
    // to originate from the web app. Bearer requests carry no ambient credential, so CSRF does not
    // apply; webhooks authenticate by signature; the device endpoints run before any credential exists.
    const path = req.url.split("?")[0]!;
    if (!bearer && !SAFE_METHODS.has(req.method) && !req.url.startsWith("/webhooks/") && !DEVICE_PUBLIC.has(path)) {
      const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
      if (origin !== webOrigin) throw forbidden("Cross-origin request rejected");
    }

    if (bearer) {
      // A bearer token never falls back to the cookie: one credential per request.
      if (!bearer.startsWith(BEARER_PREFIX)) throw unauthorized("Invalid token");
      const id = sha256(bearer);
      const session = await db.session.findUnique({ where: { id }, include: { user: true } });
      if (!session || session.kind !== "DEVICE" || session.expiresAt.getTime() <= Date.now() || session.user.deletedAt) {
        throw unauthorized("This sign-in has expired or was revoked. Sign in again.");
      }
      req.viewer = session.user;
      req.sessionId = id;
      req.sessionKind = "DEVICE";
      const now = Date.now();
      if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        await db.session.update({ where: { id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + DEVICE_SESSION_TTL_MS) } });
      }
      return;
    }

    // Project A is the ONLY browser authentication authority. Never accept a
    // user-id header, an unsigned cookie, or B's old browser sessions. Ask
    // BetterAuth to verify its own cookie, then load that exact shared user.
    if (!req.headers.cookie?.includes("better-auth.")) return;
    let response: Response;
    try {
      response = await fetch(`${env.AUTH_INTERNAL_URL}/api/auth/get-session`, {
        headers: { cookie: req.headers.cookie },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      throw Object.assign(new Error("Sign-in service is unavailable. Try again shortly."), { statusCode: 503 });
    }
    if (!response.ok) {
      if (response.status >= 500) throw Object.assign(new Error("Sign-in service is unavailable."), { statusCode: 503 });
      return;
    }
    for (const cookie of response.headers.getSetCookie()) reply.header("set-cookie", cookie);
    const verified = await response.json() as { user?: { id?: string; username?: string | null } } | null;
    if (!verified?.user?.id) return;
    const user = await db.user.findUnique({ where: { id: verified.user.id } });
    if (!user || user.deletedAt || !user.username) return;
    req.viewer = user;
    req.sessionKind = "BROWSER";
  });
});

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

export async function createSession(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await app.deps.db.session.create({
    data: {
      id: sha256(token),
      userId,
      expiresAt,
      userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
      ip: req.ip,
    },
  });
  setSessionCookie(reply, token, expiresAt, app.deps.env.isProd);
}

function setSessionCookie(reply: FastifyReply, token: string, expires: Date, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure, expires });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean) {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure });
}

/**
 * Account-level actions need the person at the website, not an editor token: a leaked extension
 * token must not mint more tokens, delete the account, sign out browsers, or give a project away.
 */
export function requireBrowserSession(req: FastifyRequest): User {
  const viewer = requireViewer(req);
  if (req.sessionKind !== "BROWSER") throw forbidden("Do this from the bld.t website");
  return viewer;
}

export function requireViewer(req: FastifyRequest): User {
  if (!req.viewer) throw unauthorized();
  return req.viewer;
}
