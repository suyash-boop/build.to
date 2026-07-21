import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

/**
 * Queue definitions shared by the web app and the worker (PRD §6.5).
 *
 * IMPORTANT: this module must only ever export `Queue` instances. Never
 * instantiate a BullMQ `Worker` here or anywhere the Next.js app can import it —
 * request contexts are short-lived and would orphan the worker's Redis
 * connection (PRD §3.1). Workers live in worker/ and nowhere else.
 *
 * Job payloads carry IDs only, never Prisma objects: payloads are JSON-
 * serialized and a captured row goes stale before a worker picks it up.
 */

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}

const url = new URL(redisUrl);
export const connection: ConnectionOptions = {
  host: url.hostname,
  port: Number(url.port || 6379),
  // BullMQ requires this to be null on blocking connections; setting it here
  // keeps the queue and worker connections configured identically.
  maxRetriesPerRequest: null,
};

export const QUEUE_NAMES = {
  processMarkdown: "process-markdown",
  reconcileCounters: "reconcile-counters",
  sendNotification: "send-notification",
} as const;

// ── Job payload types ───────────────────────────────────────────────────────

export interface ProcessMarkdownJob {
  postId: string;
}

// Repeatable maintenance job — no payload.
export type ReconcileCountersJob = Record<string, never>;

// IDs only (PRD §6.5). The processor resolves the recipient and skips self-acts.
export interface SendNotificationJob {
  type: "NEW_REACTION" | "NEW_COMMENT" | "NEW_FOLLOWER";
  actorId: string; // who caused it
  // The subject of the action; which fields are set depends on `type`.
  postId?: string;
  commentId?: string;
  targetUserId?: string; // for NEW_FOLLOWER: the followed user
}

// ── Default job options ─────────────────────────────────────────────────────
//
// removeOnComplete/removeOnFail are mandatory: without them Redis fills with
// completed job records during development (PRD §6.5). Retries are 3 attempts
// with exponential backoff.
export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

// ── Queues ──────────────────────────────────────────────────────────────────

export const processMarkdownQueue = new Queue<ProcessMarkdownJob>(
  QUEUE_NAMES.processMarkdown,
  { connection, defaultJobOptions },
);

export const reconcileCountersQueue = new Queue<ReconcileCountersJob>(
  QUEUE_NAMES.reconcileCounters,
  { connection, defaultJobOptions },
);

export const sendNotificationQueue = new Queue<SendNotificationJob>(
  QUEUE_NAMES.sendNotification,
  { connection, defaultJobOptions },
);

/** Enqueue a notification to be created off the request path (PRD §5.10). */
export async function enqueueNotification(job: SendNotificationJob) {
  return sendNotificationQueue.add(QUEUE_NAMES.sendNotification, job);
}

/** Enqueue a post for background rendering. */
export async function enqueueProcessMarkdown(postId: string) {
  return processMarkdownQueue.add(QUEUE_NAMES.processMarkdown, { postId });
}

/** Interval for the repeatable counter-reconciliation job (PRD §6.5). */
export const RECONCILE_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

/** Run a reconciliation pass immediately — used by the live demo. */
export async function enqueueReconcileNow() {
  return reconcileCountersQueue.add(QUEUE_NAMES.reconcileCounters, {});
}
