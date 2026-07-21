import type { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import type { SendNotificationJob } from "@/lib/queues";

/**
 * Create a Notification row (PRD §5.10). Runs off the request path so the
 * reaction/comment/follow action returns immediately.
 *
 * Resolves the recipient from the subject of the action and skips
 * self-notifications — you don't get pinged for reacting to your own post.
 */
export async function sendNotification(job: Job<SendNotificationJob>) {
  const { type, actorId, postId, commentId, targetUserId } = job.data;

  let recipientId: string | null = null;

  if (type === "NEW_FOLLOWER") {
    recipientId = targetUserId ?? null;
  } else if (type === "NEW_COMMENT" && commentId) {
    // Notify the post author about a new comment on their post.
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { post: { select: { userId: true } }, postId: true },
    });
    recipientId = comment?.post.userId ?? null;
  } else if (type === "NEW_REACTION" && postId) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { userId: true },
    });
    recipientId = post?.userId ?? null;
  }

  if (!recipientId) {
    return { skipped: true, reason: "recipient not found" };
  }
  if (recipientId === actorId) {
    return { skipped: true, reason: "self-action" };
  }

  await prisma.notification.create({
    data: {
      userId: recipientId,
      actorId,
      type,
      postId: postId ?? null,
      commentId: commentId ?? null,
    },
  });

  return { recipientId, type };
}
