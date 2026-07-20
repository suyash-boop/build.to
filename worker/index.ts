import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/prisma";
import {
  connection,
  QUEUE_NAMES,
  type ProcessMarkdownJob,
} from "@/lib/queues";
import { processMarkdown } from "./processors/processMarkdown";

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

console.log("worker ready — listening on:", Object.values(QUEUE_NAMES).join(", "));

// Drain in-flight jobs before exiting so a restart doesn't leave posts stuck in
// PROCESSING.
async function shutdown(signal: string) {
  console.log(`\n${signal} received — closing worker…`);
  await markdownWorker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
