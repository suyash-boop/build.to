import { createAi } from "@bldt/ai";
import { keyRing } from "@bldt/core";
import { createDb } from "@bldt/db";
import { createGithubApp } from "@bldt/github";
import { createRedis, JobClient } from "@bldt/jobs";
import { loadEnv } from "./env.ts";
import { Encrypter } from "./lib/crypto.ts";
import { PgChangeSource, RealtimeHub } from "./lib/realtime.ts";
import { buildServer } from "./server.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const jobs = new JobClient(redis);
const github = createGithubApp({
  appId: env.GITHUB_APP_ID,
  slug: env.GITHUB_APP_SLUG,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  clientId: env.GITHUB_APP_CLIENT_ID,
  clientSecret: env.GITHUB_APP_CLIENT_SECRET,
});

// The hub logs through Fastify, so it is attached after the server exists.
function loadWorkKeys() {
  if (!env.WORK_RECORD_SIGNING_KEY) return null;
  try {
    return keyRing(env.WORK_RECORD_SIGNING_KEY, env.WORK_RECORD_RETIRED_KEYS);
  } catch (err) {
    // Never echo the key itself.
    throw new Error(`WORK_RECORD_SIGNING_KEY or WORK_RECORD_RETIRED_KEYS is invalid: ${(err as Error).message.slice(0, 120)}`);
  }
}
const deps = {
  env,
  db,
  redis,
  jobs,
  github,
  encrypter: new Encrypter(env.ENCRYPTION_KEY),
  ai: createAi(env.ANTHROPIC_API_KEY),
  realtime: null as RealtimeHub | null,
  workKeys: loadWorkKeys(),
};
const app = await buildServer(deps);
if (env.REALTIME === "on") {
  const log = app.log.child({ module: "realtime" });
  deps.realtime = new RealtimeHub(db, new PgChangeSource(env.DIRECT_DATABASE_URL ?? env.DATABASE_URL, log), log);
  deps.realtime.start();
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await app.close();
    await jobs.close();
    await redis.quit();
    await db.$disconnect();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.API_PORT, host: env.API_HOST });
