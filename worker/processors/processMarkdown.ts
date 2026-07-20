import type { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { excerpt, readingTime, renderMarkdown } from "@/lib/markdown";
import type { ProcessMarkdownJob } from "@/lib/queues";

/**
 * Render a post's Markdown to sanitized HTML and mark it READY (PRD §6.5).
 *
 * The job payload carries only a postId, so the row is re-read here — by the
 * time a worker picks the job up the post may have been edited again, and the
 * latest content is the one that should be rendered.
 *
 * Uses the same lib/markdown.ts pipeline as the editor preview, so published
 * output is byte-identical to what the author previewed.
 */
export async function processMarkdown(job: Job<ProcessMarkdownJob>) {
  const { postId } = job.data;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, bodyMarkdown: true },
  });

  // The post may have been deleted between enqueue and execution. That is not
  // a failure — there is simply nothing to do.
  if (!post) {
    return { skipped: true, reason: "post no longer exists" };
  }

  await prisma.post.update({
    where: { id: postId },
    data: { processingState: "PROCESSING" },
  });

  const html = await renderMarkdown(post.bodyMarkdown);

  await prisma.post.update({
    where: { id: postId },
    data: {
      processedHtml: html,
      description: excerpt(post.bodyMarkdown),
      readingTime: readingTime(post.bodyMarkdown),
      processingState: "READY",
    },
  });

  return { postId, ok: true };
}
