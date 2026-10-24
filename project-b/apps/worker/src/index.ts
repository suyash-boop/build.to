import { Encrypter, PgChangeSource } from "@bldt/core";
import { createDb } from "@bldt/db";
import { createGithubApp } from "@bldt/github";
import { createRedis, JobClient, QUEUE, SCHEDULED_JOB_OPTIONS, type JobName, type JobPayloads } from "@bldt/jobs";
import { Queue, Worker, type Job } from "bullmq";
import { pino } from "pino";
import { z } from "zod";
import type { WorkerDeps } from "./context.ts";
import { claimForUser, recomputeProject } from "./jobs/recompute.ts";
import { refreshStaleRepositories, syncContributors, syncRepository } from "./jobs/sync.ts";
import { processWebhook } from "./jobs/webhook.ts";
import { runMaintenance } from "./jobs/maintenance.ts";
import { scanAllSignals, scanProjectSignals } from "./jobs/signals.ts";
import { deliverOutbound, fanoutOutbound } from "./jobs/outbound.ts";

const env = z
  .object({
    NODE_ENV: z.string().default("development"),
    LOG_LEVEL: z.string().default("info"),
    DATABASE_URL: z.string().min(1),
    /** Direct (non-pooled) connection for LISTEN; falls back to DATABASE_URL. */
    DIRECT_DATABASE_URL: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    REDIS_URL: z.string().min(1),
    GITHUB_APP_ID: z.string().default(""),
    GITHUB_APP_SLUG: z.string().default(""),
    GITHUB_APP_PRIVATE_KEY: z.string().default(""),
    GITHUB_APP_CLIENT_ID: z.string().default(""),
    GITHUB_APP_CLIENT_SECRET: z.string().default(""),
    GITHUB_WEBHOOK_SECRET: z.string().default(""),
    ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "Must be 32 bytes, base64"),
    WEB_ORIGIN: z.url().default("http://localhost:3000"),
    WEBHOOKS_ALLOW_PRIVATE: z.enum(["true", "false"]).default("false"),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  })
  .parse(process.env);
// Links in notifications and outbound webhooks are built from this; a localhost default would ship broken links.
if (env.NODE_ENV === "production" && !process.env.WEB_ORIGIN) throw new Error("WEB_ORIGIN must be set in production");
if (env.NODE_ENV === "production" && env.WEBHOOKS_ALLOW_PRIVATE === "true") throw new Error("WEBHOOKS_ALLOW_PRIVATE must not be enabled in production");

const log = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "production" ? {} : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
});

const db = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY * 2 });
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
const deps: WorkerDeps = {
  db,
  github,
  jobs,
  log,
  encrypter: new Encrypter(env.ENCRYPTION_KEY),
  webOrigin: `${env.WEB_ORIGIN}/projects`,
  allowPrivateWebhooks: env.WEBHOOKS_ALLOW_PRIVATE === "true",
};

async function handle(job: Job) {
  const name = job.name as JobName;
  const started = Date.now();
  switch (name) {
    case "webhook.process": {
      const d = job.data as JobPayloads["webhook.process"];
      await processWebhook(deps, d.deliveryId, d.event, d.payload as Record<string, unknown>);
      break;
    }
    case "repo.sync":
      await syncRepository(deps, (job.data as JobPayloads["repo.sync"]).repositoryId);
      break;
    case "repo.contributors": {
      const d = job.data as JobPayloads["repo.contributors"];
      await syncContributors(deps, d.repositoryId, d.attempt);
      break;
    }
    case "repos.refresh":
      await refreshStaleRepositories(deps);
      break;
    case "maintenance.daily":
      await runMaintenance(deps);
      break;
    case "signals.scan":
      await scanProjectSignals(deps, (job.data as JobPayloads["signals.scan"]).projectId);
      break;
    case "signals.scanAll":
      await scanAllSignals(deps);
      break;
    case "outbound.fanout":
      await fanoutOutbound(deps);
      break;
    case "outbound.deliver":
      await deliverOutbound(deps, (job.data as JobPayloads["outbound.deliver"]).deliveryId);
      break;
    case "project.recompute":
      await recomputeProject(deps, (job.data as JobPayloads["project.recompute"]).projectId);
      break;
    case "user.claim": {
      const d = job.data as JobPayloads["user.claim"];
      await claimForUser(deps, d.userId, d.githubUserId);
      break;
    }
    default:
      log.warn({ name }, "unknown job");
  }
  log.debug({ name, id: job.id, ms: Date.now() - started }, "job done");
}

const workers = Object.values(QUEUE).map((queue) => {
  const w = new Worker(queue, handle, {
    connection: redis,
    // Deliveries mostly wait on the network, so that queue runs wider.
    concurrency: queue === QUEUE.outbound ? env.WORKER_CONCURRENCY * 4 : env.WORKER_CONCURRENCY,
    // GitHub secondary rate limits punish bursts; cap throughput per worker.
    limiter: queue === QUEUE.github ? { max: 20, duration: 1000 } : undefined,
  });
  w.on("failed", (job, err) => log.error({ err, name: job?.name, id: job?.id, attempts: job?.attemptsMade }, "job failed"));
  w.on("error", (err) => log.error({ err }, "worker error"));
  return w;
});

// Safety-net refresh every 6 hours. Upsert is idempotent across restarts and replicas.
const scheduler = new Queue(QUEUE.github, { connection: redis });
await scheduler.upsertJobScheduler("repos-refresh", { every: 6 * 3600 * 1000 }, { name: "repos.refresh", data: {}, opts: SCHEDULED_JOB_OPTIONS });
const maintenance = new Queue(QUEUE.projects, { connection: redis });
await maintenance.upsertJobScheduler("maintenance-daily", { pattern: "17 3 * * *" }, { name: "maintenance.daily", data: {}, opts: SCHEDULED_JOB_OPTIONS });
// Time-based signals (stalled, overdue, waiting) appear without any event, so scan on a clock too.
await maintenance.upsertJobScheduler("signals-scan-all", { every: 30 * 60 * 1000 }, { name: "signals.scanAll", data: {}, opts: SCHEDULED_JOB_OPTIONS });
const outbound = new Queue(QUEUE.outbound, { connection: redis });
await outbound.upsertJobScheduler("outbound-fanout", { every: 10 * 1000 }, { name: "outbound.fanout", data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } });

// Deliver within a second of the change, not at the next 10s sweep: the realtime triggers already
// announce new activity and signals. The sweep stays as the safety net; dedupe collapses bursts
// (and replicas) into one fan-out.
const changes = new PgChangeSource(env.DIRECT_DATABASE_URL ?? env.DATABASE_URL, log.child({ module: "outbound-trigger" }));
changes.start(
  (c) => {
    if (c.k === "activity" || c.k === "signal") void jobs.enqueue("outbound.fanout", {}, { dedupeId: "kick", delayMs: 500 }).catch((err) => log.warn({ err }, "could not queue fan-out"));
  },
  () => {},
);

log.info({ queues: Object.values(QUEUE), concurrency: env.WORKER_CONCURRENCY }, "worker started");

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "worker shutting down");
  const force = setTimeout(() => process.exit(1), 30_000);
  force.unref();
  // Let in-flight jobs finish; BullMQ re-queues anything interrupted.
  await changes.stop();
  await Promise.all(workers.map((w) => w.close()));
  await scheduler.close();
  await maintenance.close();
  await outbound.close();
  await jobs.close();
  await redis.quit();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
