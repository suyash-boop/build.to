import type { Me } from "@bldt/contracts";
import { userOctokit } from "@bldt/github";
import { generateState, GitHub } from "arctic";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireBrowserSession, requireViewer } from "../plugins/auth.ts";
import { conflict } from "../lib/errors.ts";

const STATE_COOKIE = "buildto_github_connect";
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\r\n]/.test(next)) return "/home";
  return next.slice(0, 500);
}

/** GitHub App account LINKING, not another login system. */
export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { env, db, encrypter, jobs } = app.deps;
  const configured = Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET && env.GITHUB_APP_SLUG);
  const github = new GitHub(env.GITHUB_APP_CLIENT_ID, env.GITHUB_APP_CLIENT_SECRET, `${env.WEB_ORIGIN}/projects/api/auth/github/callback`);

  app.get("/auth/github/login", { schema: { querystring: z.object({ next: z.string().optional() }) } }, async (req, reply) => {
    const user = requireBrowserSession(req);
    if (!configured) return reply.redirect(`${env.WEB_ORIGIN}/projects/settings?github=unavailable`);
    const state = generateState();
    reply.setCookie(STATE_COOKIE, JSON.stringify({ state, userId: user.id, next: safeNext(req.query.next) }), {
      path: "/projects/api/auth/github", httpOnly: true, sameSite: "lax", secure: env.isProd, maxAge: 600, signed: true,
    });
    return reply.redirect(github.createAuthorizationURL(state, []).toString());
  });

  app.get("/auth/github/callback", { schema: { querystring: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }) } }, async (req, reply) => {
    const user = requireBrowserSession(req);
    const fail = () => reply.redirect(`${env.WEB_ORIGIN}/projects/settings?github=failed`);
    const raw = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: "/projects/api/auth/github" });
    if (!configured || !raw || !req.query.code || !req.query.state || req.query.error) return fail();
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return fail();
    let stored: { state: string; userId: string; next: string };
    try { stored = JSON.parse(unsigned.value); } catch { return fail(); }
    if (stored.state !== req.query.state || stored.userId !== user.id) return fail();
    const tokens = await github.validateAuthorizationCode(req.query.code);
    const { data: ghUser } = await userOctokit(tokens.accessToken()).rest.users.getAuthenticated();
    const other = await db.githubAccount.findUnique({ where: { githubUserId: BigInt(ghUser.id) } });
    if (other && other.userId !== user.id) throw conflict("This GitHub account is already connected to another build.to account.");
    const current = await db.githubAccount.findUnique({ where: { userId: user.id } });
    if (current && current.githubUserId !== BigInt(ghUser.id)) throw conflict("Disconnect your current GitHub App account before connecting a different account.");
    let expires: Date | null = null;
    try { expires = tokens.accessTokenExpiresAt(); } catch { /* Non-expiring GitHub App tokens. */ }
    const data = { githubUserId: BigInt(ghUser.id), login: ghUser.login, accessToken: encrypter.encrypt(tokens.accessToken()), refreshToken: tokens.hasRefreshToken() ? encrypter.encrypt(tokens.refreshToken()) : null, tokenExpiresAt: expires };
    await db.githubAccount.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    await jobs.enqueue("user.claim", { userId: user.id, githubUserId: String(ghUser.id) });
    return reply.redirect(`${env.WEB_ORIGIN}/projects${safeNext(stored.next)}`);
  });

  // Browser sign-out happens through BetterAuth's /api/auth/sign-out. This
  // endpoint only revokes a device token, never creates/deletes an A session.
  app.post("/auth/logout", async (req) => {
    if (req.sessionKind === "DEVICE" && req.sessionId) await db.session.deleteMany({ where: { id: req.sessionId } });
    return { ok: true };
  });
  app.get("/me", async (req) => {
    const viewer = requireViewer(req);
    const [gh, unread] = await Promise.all([
      db.githubAccount.findUnique({ where: { userId: viewer.id }, select: { login: true } }),
      db.notification.count({ where: { recipientId: viewer.id, readAt: null } }),
    ]);
    return {
      id: viewer.id, username: viewer.username, displayName: viewer.displayName, avatarUrl: viewer.avatarUrl,
      email: viewer.email, headline: viewer.headline, bio: viewer.bio, location: viewer.location,
      websiteUrl: viewer.websiteUrl, focusAreas: viewer.focusAreas, openToWork: viewer.openToWork,
      meetingUrl: viewer.meetingUrl, githubLogin: gh?.login ?? null, createdAt: viewer.createdAt.toISOString(),
      unreadNotifications: unread, features: { ai: app.deps.ai !== null, githubApp: configured },
    } satisfies Me;
  });
  app.get("/me/sessions", async (req) => {
    const viewer = requireBrowserSession(req);
    const sessions = await db.session.findMany({ where: { userId: viewer.id, kind: "DEVICE", expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
    return { items: sessions.map((s) => ({ id: s.id.slice(0, 16), current: false, kind: s.kind, clientName: s.clientName, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString() })) };
  });
  app.delete("/me/sessions/:id", { schema: { params: z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) }) } }, async (req) => {
    const viewer = requireBrowserSession(req);
    await db.session.deleteMany({ where: { userId: viewer.id, id: { startsWith: req.params.id }, kind: "DEVICE" } });
    return { ok: true };
  });
};
