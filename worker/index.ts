import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/prisma";
import {
  connection,
  QUEUE_NAMES,
  RECONCILE_INTERVAL_MS,
  FLUSH_VIEWS_INTERVAL_MS,
  reconcileCountersQueue,
  flushViewCountsQueue,
  type ProcessMarkdownJob,
  type ReconcileCountersJob,
  type SendNotificationJob,
  type FlushViewCountsJob,
} from "@/lib/queues";
import { processMarkdown } from "./processors/processMarkdown";
import { reconcileCounters } from "./processors/reconcileCounters";
import { sendNotification } from "./processors/sendNotification";
import { flushViewCounts } from "./processors/flushViewCounts";

/**
 * Worker process (PRD §3.1). This is the ONLY place a BullMQ `Worker` is
 * instantiated — never inside a Next.js route handler, server component, or
 * proxy, where the short-lived request context would orphan its Redis
 * connection.
 *
 * Run via `tsx watch worker/index.ts`; `npm run dev` boots it alongside the web
 * app with concurrently.
 */

const markdownWorker = new Worker<ProcessMarkdownJob>(
  QUEUE_NAMES.processMarkdown,
  processMarkdown,
  { connection, concurrency: 5 },
);

markdownWorker.on("completed", (job, result) => {
  console.log(`[process-markdown] completed job ${job.id}`, result);
});

markdownWorker.on("failed", async (job, err) => {
  console.error(
    `[process-markdown] job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}):`,
    err.message,
  );

  // Only on the final attempt: mark the post FAILED so the UI shows an error
  // instead of polling forever (PRD §6.5).
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    try {
      await prisma.post.update({
        where: { id: job.data.postId },
        data: { processingState: "FAILED" },
      });
    } catch (updateErr) {
      console.error("[process-markdown] could not mark post FAILED:", updateErr);
    }
  }
});

// ── reconcile-counters ──────────────────────────────────────────────────────

const reconcileWorker = new Worker<ReconcileCountersJob>(
  QUEUE_NAMES.reconcileCounters,
  reconcileCounters,
  { connection, concurrency: 1 }, // serial: two passes at once would race
);

reconcileWorker.on("completed", (job, result) => {
  if (result.fixes.length > 0) {
    console.log(
      `[reconcile-counters] job ${job.id} corrected ${result.fixes.length} counter(s):`,
    );
    for (const fix of result.fixes) console.log(`  • ${fix}`);
  } else {
    console.log(
      `[reconcile-counters] job ${job.id}: ${result.checked} records checked, no drift`,
    );
  }
});

reconcileWorker.on("failed", (job, err) => {
  console.error(`[reconcile-counters] job ${job?.id} failed:`, err.message);
});

/**
 * Register the repeatable pass. Upserting by a stable name means restarting the
 * worker re-uses the same schedule instead of stacking duplicates. Wrapped in a
 * function rather than a top-level await, which tsx's CJS transform rejects.
 */
async function scheduleReconcile() {
  await reconcileCountersQueue.upsertJobScheduler(
    "reconcile-counters-every-10m",
    { every: RECONCILE_INTERVAL_MS },
    { name: QUEUE_NAMES.reconcileCounters },
  );
  console.log(
    `reconcile-counters scheduled every ${RECONCILE_INTERVAL_MS / 60000} minutes`,
  );
}
void scheduleReconcile();

// ── send-notification ───────────────────────────────────────────────────────

const notificationWorker = new Worker<SendNotificationJob>(
  QUEUE_NAMES.sendNotification,
  sendNotification,
  { connection, concurrency: 5 },
);

notificationWorker.on("failed", (job, err) => {
  console.error(`[send-notification] job ${job?.id} failed:`, err.message);
});

// ── flush-view-counts ───────────────────────────────────────────────────────

const flushViewsWorker = new Worker<FlushViewCountsJob>(
  QUEUE_NAMES.flushViewCounts,
  flushViewCounts,
  { connection, concurrency: 1 }, // serial: two flushes at once would race GETDEL
);

flushViewsWorker.on("completed", (job, result) => {
  if (result.posts > 0) {
    console.log(
      `[flush-view-counts] job ${job.id}: +${result.totalViews} views across ${result.posts} post(s)`,
    );
  }
});

flushViewsWorker.on("failed", (job, err) => {
  console.error(`[flush-view-counts] job ${job?.id} failed:`, err.message);
});

async function scheduleFlushViews() {
  await flushViewCountsQueue.upsertJobScheduler(
    "flush-view-counts-every-5m",
    { every: FLUSH_VIEWS_INTERVAL_MS },
    { name: QUEUE_NAMES.flushViewCounts },
  );
  console.log(
    `flush-view-counts scheduled every ${FLUSH_VIEWS_INTERVAL_MS / 60000} minutes`,
  );
}
void scheduleFlushViews();

console.log("worker ready — listening on:", Object.values(QUEUE_NAMES).join(", "));

// Drain in-flight jobs before exiting so a restart doesn't leave posts stuck in
// PROCESSING.
async function shutdown(signal: string) {
  console.log(`\n${signal} received — closing workers…`);
  await Promise.all([
    markdownWorker.close(),
    reconcileWorker.close(),
    notificationWorker.close(),
    flushViewsWorker.close(),
  ]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
