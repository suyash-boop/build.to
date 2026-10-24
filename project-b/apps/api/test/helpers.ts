import { createHmac, generateKeyPairSync } from "node:crypto";
import { createDb, requireLocalTestDatabase, type Db } from "@bldt/db";
import { createGithubApp } from "@bldt/github";
import { createRedis, type JobClient } from "@bldt/jobs";
import type { Deps } from "../src/context.ts";
import { loadEnv } from "../src/env.ts";
import { Encrypter, generateToken, sha256 } from "../src/lib/crypto.ts";
import { PgChangeSource, RealtimeHub, type ChangeSource } from "../src/lib/realtime.ts";
import { keyRing } from "@bldt/core";
import { buildServer, type AppInstance } from "../src/server.ts";

export const TEST_DB_URL = requireLocalTestDatabase(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
export const ORIGIN = "http://localhost:3000";
export const WEBHOOK_SECRET = "test-webhook-secret-123456";

export interface Enqueued {
  name: string;
  data: unknown;
}

export interface TestContext {
  app: AppInstance;
  db: Db;
  jobs: Enqueued[];
  close(): Promise<void>;
}

export const TEST_WORK_KEY = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

export async function setup(opts: { ai?: Deps["ai"]; realtime?: boolean } = {}): Promise<TestContext> {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    WEB_ORIGIN: ORIGIN,
    DATABASE_URL: TEST_DB_URL,
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    COOKIE_SECRET: "x".repeat(40),
    GITHUB_APP_ID: "1",
    GITHUB_APP_SLUG: "bldt-test",
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    GITHUB_APP_CLIENT_ID: "id",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  const db = createDb(TEST_DB_URL, { max: 5 });
  const redis = createRedis(env.REDIS_URL);
  // Separate key space from development so rate-limit counters do not collide.
  await redis.select(1);
  await redis.flushdb();

  const enqueued: Enqueued[] = [];
  const jobs = {
    enqueue: async (name: string, data: unknown) => {
      enqueued.push({ name, data });
      return {} as never;
    },
    close: async () => {},
  } as unknown as JobClient;

  const deps: Deps = {
    env,
    db,
    redis,
    jobs,
    github: createGithubApp({
      appId: env.GITHUB_APP_ID,
      slug: env.GITHUB_APP_SLUG,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    }),
    encrypter: new Encrypter(env.ENCRYPTION_KEY),
    ai: opts.ai ?? null,
    realtime: null,
    workKeys: keyRing(TEST_WORK_KEY),
  };
  const app = await buildServer(deps);
  await app.ready();
  if (opts.realtime) {
    // Real triggers and a real LISTEN connection; resolve once the listener is subscribed.
    let ready!: () => void;
    const listening = new Promise<void>((r) => (ready = r));
    const pgSource = new PgChangeSource(TEST_DB_URL, app.log);
    const source: ChangeSource = { start: (onChange, onReady) => pgSource.start(onChange, (re) => (onReady(re), ready())), stop: () => pgSource.stop() };
    deps.realtime = new RealtimeHub(db, source, app.log);
    deps.realtime.start();
    await listening;
  }
  return {
    app,
    db,
    jobs: enqueued,
    async close() {
      await app.close();
      await redis.quit();
      await db.$disconnect();
    },
  };
}

/** Wipe everything except the technology catalog. */
export async function reset(db: Db) {
  await db.$executeRawUnsafe(`
    TRUNCATE "ActivityEvent","Notification","AuditLog","WebhookDelivery","Comment","PullRequestTask","PullRequest",
      "Task","Milestone","Release","Deployment","Contribution","ProjectTechnology","Invitation","JoinRequest",
      "ProjectRepository","ProjectMember","Project","Repository","GithubInstallation","Session","GithubAccount","User"
    RESTART IDENTITY CASCADE`);
}

export interface TestUser {
  id: string;
  username: string;
  cookie: string;
}

let seq = 0;
export async function createUser(db: Db, username = `user${++seq}`): Promise<TestUser> {
  const user = await db.user.create({ data: { username, displayName: username.toUpperCase() } });
  const token = generateToken();
  await db.session.create({ data: { id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
  return { id: user.id, username, cookie: `bldt_session=${token}` };
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Request helper that sets the session cookie and the Origin header mutations require. */
export function client(app: AppInstance, user?: TestUser) {
  const call = async (method: Method, url: string, body?: unknown) => {
    const res = await app.inject({
      method,
      url,
      headers: {
        ...(user ? { cookie: user.cookie } : {}),
        ...(method !== "GET" ? { origin: ORIGIN } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    let json: any = null;
    try {
      json = res.json();
    } catch {
      json = null;
    }
    return { status: res.statusCode, body: json, raw: res };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, body?: unknown) => call("POST", url, body ?? {}),
    patch: (url: string, body: unknown) => call("PATCH", url, body),
    del: (url: string, body?: unknown) => call("DELETE", url, body),
  };
}

export function sign(body: string) {
  return "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}
