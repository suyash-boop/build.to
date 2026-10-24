import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { serializeSignedCookie } from "better-call";

// Never infer a test target from the real DATABASE_URL. Explicit local targets
// prevent accidental fixture writes or migration commands against user data.
const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error("Set TEST_DATABASE_URL to an isolated local *_test database first.");
const parsed = new URL(target);
if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !parsed.pathname.includes("_test")) {
  throw new Error("Integration checks refuse non-local or non-test databases.");
}
const redisTarget = process.env.TEST_REDIS_URL;
if (!redisTarget || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(redisTarget).hostname)) throw new Error("Set TEST_REDIS_URL to an isolated local Redis/Valkey service.");
process.env.DATABASE_URL = target;
process.env.REDIS_URL = redisTarget;
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.NODE_ENV = "test";

const authority = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const response = await auth.handler(new Request(`${process.env.BETTER_AUTH_URL}${req.url}`, {
      method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks).toString() } : {}),
    }));
    res.statusCode = response.status;
    response.headers.forEach((v, k) => { if (k !== "set-cookie") res.setHeader(k, v); });
    if (response.headers.getSetCookie().length) res.setHeader("set-cookie", response.headers.getSetCookie());
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise<void>((resolve) => authority.listen(0, "127.0.0.1", resolve));
const address = authority.address();
if (!address || typeof address === "string") throw new Error("Could not start test sign-in authority");
const origin = `http://127.0.0.1:${address.port}`;
process.env.BETTER_AUTH_URL = origin;
const { auth } = await import("../lib/auth.ts");
const { prisma } = await import("../lib/prisma.ts");
const { createDb } = await import("@bldt/db");
const { createRedis } = await import("@bldt/jobs");
const { createGithubApp } = await import("@bldt/github");
const { Encrypter } = await import("../project-b/apps/api/src/lib/crypto.ts");
const { loadEnv } = await import("../project-b/apps/api/src/env.ts");
const { buildServer } = await import("../project-b/apps/api/src/server.ts");
const { getProfileProjects } = await import("../lib/workspace.ts");
const db = createDb(target);
const redis = createRedis(redisTarget);
const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: target, REDIS_URL: redisTarget, WEB_ORIGIN: origin, AUTH_INTERNAL_URL: origin, LOG_LEVEL: "error", ENCRYPTION_KEY: randomBytes(32).toString("base64"), COOKIE_SECRET: randomBytes(48).toString("base64url") });
const { JobClient } = await import("@bldt/jobs");
const jobs = new JobClient(redis);
const app = await buildServer({ env, db, redis, jobs, github: createGithubApp({ appId: "", slug: "", privateKey: "", webhookSecret: "", clientId: "", clientSecret: "" }), encrypter: new Encrypter(env.ENCRYPTION_KEY), ai: null, realtime: null, workKeys: null });
const suffix = randomBytes(4).toString("hex");
const aliceId = `merge_alice_${suffix}`; // Deliberately NOT a UUID.
const bobId = `merge_bob_${suffix}`;
const username = `alice_${suffix}`;
const checks: string[] = [];
const check = (name: string) => { checks.push(name); console.log(`✓ ${name}`); };

try {
  await prisma.user.createMany({ data: [
    { id: aliceId, username, name: "Alice from A", email: `${aliceId}@example.test`, profileImage: "https://example.test/alice.png" },
    { id: bobId, username: `bob_${suffix}`, name: "Bob from A", email: `${bobId}@example.test` },
  ] });
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { id: `session_${suffix}`, token, userId: aliceId, expiresAt: new Date(Date.now() + 3600000) } });
  const cookie = (await serializeSignedCookie("better-auth.session_token", token, process.env.BETTER_AUTH_SECRET!)).split(";")[0]!;
  const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, session = cookie) => {
    const response = await app.inject({ method, url, headers: { ...(session ? { cookie: session } : {}), origin, ...(payload ? { "content-type": "application/json" } : {}) }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
    return { status: response.statusCode, body: response.payload ? response.json() : null };
  };
  let result = await call("GET", "/me");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.id, aliceId);
  assert.equal(result.body.displayName, "Alice from A");
  check("B accepts A's real BetterAuth signed session and existing text ID");

  assert.equal((await call("GET", "/me", undefined, "better-auth.session_token=forged")).status, 401);
  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { "x-user-id": aliceId } })).statusCode, 401);
  check("forged cookies and user-id headers cannot impersonate a user");

  result = await call("POST", "/projects", { name: "Merged workspace", slug: `merge-${suffix}`, key: "MERGE", visibility: "PRIVATE" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const projectPath = `/projects/${username}/merge-${suffix}`;
  const project = await prisma.project.findUniqueOrThrow({ where: { ownerId_slug: { ownerId: aliceId, slug: `merge-${suffix}` } } });
  assert.equal(project.ownerId, aliceId);
  check("a manual B project is immediately readable through A's Prisma client");

  const post = await prisma.post.create({ data: { userId: aliceId, title: "Merge article", slug: `merge-article-${suffix}`, bodyMarkdown: "Shared identity, distinct content.", published: true, processingState: "READY", processedHtml: "<p>Shared identity, distinct content.</p>" } });
  assert.equal((await call("GET", projectPath, undefined, "")).status, 404);
  assert.equal((await getProfileProjects(aliceId)).some((m) => m.project.id === project.id), false);
  assert.equal((await getProfileProjects(aliceId, aliceId)).some((m) => m.project.id === project.id), true);
  check("private projects are hidden from anonymous visitors and A's public profiles");

  result = await call("POST", `${projectPath}/tasks`, { title: "Test shared assignee", assigneeId: aliceId });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(await prisma.task.count({ where: { projectId: project.id, assigneeId: aliceId } }), 1);
  check("task assignment accepts existing BetterAuth IDs (not just UUIDs)");

  // An existing A user can be invited without ever signing up in B.
  const bobToken = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { id: `bob_session_${suffix}`, token: bobToken, userId: bobId, expiresAt: new Date(Date.now() + 3600000) } });
  const bobCookie = (await serializeSignedCookie("better-auth.session_token", bobToken, process.env.BETTER_AUTH_SECRET!)).split(";")[0]!;
  result = await call("POST", `${projectPath}/invitations`, { username: `bob_${suffix}`, role: "CONTRIBUTOR" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(await prisma.projectNotification.count({ where: { recipientId: bobId, readAt: null } }), 1);
  assert.equal((await call("GET", "/me", undefined, bobCookie)).body.unreadNotifications, 1);
  assert.equal((await call("POST", `/invitations/${result.body.id}/respond`, { accept: true }, bobCookie)).status, 200);
  assert.equal(await prisma.projectMember.count({ where: { projectId: project.id, userId: bobId } }), 1);
  check("A users can collaborate in B and notifications use the shared database");

  const communityComment = await prisma.comment.create({ data: { postId: post.id, userId: bobId, bodyMarkdown: "Article comment", processedHtml: "<p>Article comment</p>" } });
  await db.comment.create({ data: { projectId: project.id, subjectType: "PROJECT", subjectId: project.id, authorId: bobId, body: "Workspace comment" } });
  assert.equal((await prisma.comment.findUniqueOrThrow({ where: { id: communityComment.id } })).bodyMarkdown, "Article comment");
  assert.equal(await prisma.projectComment.count({ where: { projectId: project.id } }), 1);
  check("article and workspace comments remain separate domains in one database");

  result = await call("PATCH", "/me", { displayName: "Updated in workspace", bio: "One profile across both apps." });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: aliceId } })).name, "Updated in workspace");
  await prisma.user.update({ where: { id: aliceId }, data: { name: "Updated in community" } });
  assert.equal((await call("GET", "/me")).body.displayName, "Updated in community");
  assert.equal(await prisma.user.count({ where: { id: { in: [aliceId, bobId] } } }), 2);
  check("profile updates work in both directions without duplicate users");

  result = await call("GET", "/search/full?q=shared");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  check("workspace full-text search works with shared text user IDs");

  const badOrigin = await app.inject({ method: "POST", url: "/projects", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, payload: JSON.stringify({ name: "Forbidden" }) });
  assert.equal(badOrigin.statusCode, 403);
  assert.equal((await call("POST", "/auth/github/login")).status, 404);
  assert.equal((await call("GET", "/auth/github/login")).status, 302);
  assert.equal((await call("DELETE", "/me", { confirm: username })).status, 409);
  assert.ok(await prisma.post.findUnique({ where: { id: post.id } }));
  check("CSRF, disabled integrations, and partial account deletion fail safely");

  const signout = await fetch(`${origin}/api/auth/sign-out`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" });
  assert.equal(signout.status, 200);
  assert.equal((await call("GET", "/me")).status, 401);
  check("signing out of A also revokes access to B");
  console.log(`\n${checks.length} database/auth integration checks passed.`);
} finally {
  // Remove only this run's explicitly named fixtures, never truncate any table.
  await prisma.project.deleteMany({ where: { ownerId: { in: [aliceId, bobId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [aliceId, bobId] } } });
  await app.close();
  await jobs.close();
  await redis.quit();
  await db.$disconnect();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => authority.close((error) => error ? reject(error) : resolve()));
}
