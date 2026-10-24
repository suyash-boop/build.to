import { randomBytes, randomInt } from "node:crypto";
import { notify } from "@bldt/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { generateToken, sha256 } from "../lib/crypto.ts";
import { AppError, notFound } from "../lib/errors.ts";
import { BEARER_PREFIX, DEVICE_SESSION_TTL_MS, requireBrowserSession, requireViewer } from "../plugins/auth.ts";

/**
 * Device sign-in for editor extensions, following OAuth 2.0 Device Authorization Grant (RFC 8628).
 * The editor never sees a password or a browser cookie: it shows a short code, the person approves
 * it while signed in on the web, and the editor receives its own revocable session token.
 */

const CODE_TTL_MS = 15 * 60 * 1000;
const INTERVAL_SEC = 5;
/** A browser-created link is redeemed by the editor within seconds; keep the window short. */
const LINK_TTL_MS = 2 * 60 * 1000;
/** No vowels (no accidental words), no lookalikes such as 0/O or 1/I. */
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

function userCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Accept what people type: lower case, missing dash, stray spaces. */
export function normalizeUserCode(raw: string) {
  const c = raw.toUpperCase().replace(/[^A-Z]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : null;
}

const deviceError = (code: string, message: string, status = 400) => new AppError(status, code, message);

export const deviceAuthRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env } = app.deps;

  app.post(
    "/auth/device/code",
    {
      schema: { body: z.object({ clientName: z.string().trim().min(1).max(80) }) },
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req) => {
      const deviceCode = generateToken();
      // Retry on the rare user-code collision.
      for (let attempt = 0; ; attempt++) {
        const code = userCode();
        try {
          await db.deviceAuthorization.create({
            data: { id: sha256(deviceCode), userCode: code, clientName: req.body.clientName, ip: req.ip, intervalSec: INTERVAL_SEC, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
          });
          const verificationUri = `${env.WEB_ORIGIN.replace(/\/$/, "")}/projects/device`;
          return {
            deviceCode,
            userCode: code,
            verificationUri,
            verificationUriComplete: `${verificationUri}?code=${code}`,
            expiresIn: CODE_TTL_MS / 1000,
            interval: INTERVAL_SEC,
          };
        } catch (err) {
          if (attempt >= 3) throw err;
        }
      }
    },
  );

  app.post(
    "/auth/device/token",
    { schema: { body: z.object({ deviceCode: z.string().min(10).max(100) }) }, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req) => {
      const id = sha256(req.body.deviceCode);
      const auth = await db.deviceAuthorization.findUnique({ where: { id } });
      if (!auth) throw deviceError("invalid_grant", "Unknown device code");
      const now = new Date();
      if (auth.expiresAt <= now) throw deviceError("expired_token", "The code expired. Start sign-in again.");
      if (auth.status === "DENIED") throw deviceError("access_denied", "Sign-in was declined in the browser.");
      if (auth.status === "CONSUMED") throw deviceError("invalid_grant", "This code was already used.");
      if (auth.status === "PENDING") {
        // Polling faster than the interval earns a longer one (RFC 8628 section 3.5).
        const tooSoon = auth.lastPolledAt && now.getTime() - auth.lastPolledAt.getTime() < (auth.intervalSec - 1) * 1000;
        await db.deviceAuthorization.update({ where: { id }, data: { lastPolledAt: now, ...(tooSoon ? { intervalSec: auth.intervalSec + 5 } : {}) } });
        if (tooSoon) throw deviceError("slow_down", "Polling too fast", 400);
        throw deviceError("authorization_pending", "Waiting for approval in the browser");
      }

      // APPROVED: hand out exactly one token, even if two polls race.
      const { count } = await db.deviceAuthorization.updateMany({ where: { id, status: "APPROVED" }, data: { status: "CONSUMED" } });
      if (count === 0) throw deviceError("invalid_grant", "This code was already used.");
      const accessToken = `${BEARER_PREFIX}${randomBytes(32).toString("base64url")}`;
      const expiresAt = new Date(Date.now() + DEVICE_SESSION_TTL_MS);
      await db.session.create({
        data: { id: sha256(accessToken), userId: auth.userId!, kind: "DEVICE", clientName: auth.clientName, expiresAt, userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null, ip: req.ip },
      });
      // A record in the inbox when a device actually connects, so one nobody remembers is noticed.
      await notify(db, [auth.userId!], "security.device_signed_in", { clientName: auth.clientName, ip: req.ip });
      const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId! }, select: { id: true, username: true, displayName: true, avatarUrl: true } });
      return { accessToken, tokenType: "Bearer", expiresAt: expiresAt.toISOString(), user };
    },
  );

  /**
   * One-click connect from the browser: the signed-in person clicks "Connect VS Code", which creates an
   * already-approved, short-lived code and hands it to VS Code through a vscode:// link. The editor
   * redeems it at /auth/device/token like any other device code. The editor confirms the account
   * before keeping the session, so a link someone else sends cannot silently sign you in as them.
   */
  app.post(
    "/auth/device/link",
    { schema: { body: z.object({ clientName: z.string().trim().min(1).max(80).default("VS Code") }) }, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const viewer = requireBrowserSession(req);
      const deviceCode = generateToken();
      for (let attempt = 0; ; attempt++) {
        try {
          await db.deviceAuthorization.create({
            data: {
              id: sha256(deviceCode),
              userCode: userCode(),
              clientName: req.body.clientName,
              status: "APPROVED",
              userId: viewer.id,
              ip: req.ip,
              intervalSec: INTERVAL_SEC,
              expiresAt: new Date(Date.now() + LINK_TTL_MS),
            },
          });
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
        }
      }
      return { deviceCode, expiresIn: LINK_TTL_MS / 1000 };
    },
  );

  /** The approval page reads what is asking, so the person can tell a legitimate request from a phishing one. */
  app.get("/auth/device/:code", { schema: { params: z.object({ code: z.string().max(20) }) } }, async (req) => {
    requireViewer(req);
    const code = normalizeUserCode(req.params.code);
    const auth = code ? await db.deviceAuthorization.findUnique({ where: { userCode: code } }) : null;
    if (!auth || auth.expiresAt <= new Date()) throw notFound("That code is not valid or has expired. Start sign-in again from your editor.");
    return { userCode: auth.userCode, clientName: auth.clientName, ip: auth.ip, createdAt: auth.createdAt.toISOString(), status: auth.status };
  });

  app.post(
    "/auth/device/:code/:decision",
    { schema: { params: z.object({ code: z.string().max(20), decision: z.enum(["approve", "deny"]) }) } },
    async (req) => {
      const viewer = requireBrowserSession(req);
      const code = normalizeUserCode(req.params.code);
      if (!code) throw notFound("That code is not valid.");
      const approve = req.params.decision === "approve";
      const { count } = await db.deviceAuthorization.updateMany({
        where: { userCode: code, status: "PENDING", expiresAt: { gt: new Date() } },
        data: approve ? { status: "APPROVED", userId: viewer.id } : { status: "DENIED" },
      });
      if (count === 0) throw notFound("That code is not valid, has expired, or was already used.");
      return { ok: true };
    },
  );
};
