"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { renderMarkdown } from "@/lib/markdown";
import { enqueueNotification } from "@/lib/queues";
import { invalidate, cacheKeys } from "@/lib/cache";
import { revalidatePath } from "next/cache";
import { MAX_DEPTH, TOMBSTONE, type CommentResult } from "@/lib/comment-constants";

/**
 * Add a comment or reply (PRD §5.6).
 *
 * Comments render synchronously — they are short, so the worker round trip
 * would cost more than the render. They go through the same sanitizing pipeline
 * as posts.
 *
 * Depth is capped at 3: a reply to a depth-3 comment attaches to that comment
 * rather than nesting deeper, so the thread stays readable and the tree stays
 * shallow enough to assemble in memory.
 */
export async function addComment(
  postId: string,
  bodyMarkdown: string,
  parentId: string | null,
): Promise<CommentResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in to comment." };

  const body = bodyMarkdown.trim();
  if (!body) return { ok: false, error: "Comment cannot be empty." };
  if (body.length > 10_000) {
    return { ok: false, error: "Comment is too long." };
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, slug: true, user: { select: { username: true } } },
  });
  if (!post) return { ok: false, error: "That post no longer exists." };

  let depth = 0;
  let resolvedParentId = parentId;

  if (parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { id: true, depth: true, postId: true },
    });
    if (!parent || parent.postId !== postId) {
      return { ok: false, error: "That comment no longer exists." };
    }
    if (parent.depth >= MAX_DEPTH - 1) {
      // At the cap: attach as a sibling of the parent instead of nesting.
      depth = MAX_DEPTH - 1;
      resolvedParentId = parent.id;
    } else {
      depth = parent.depth + 1;
    }
  }

  const processedHtml = await renderMarkdown(body);

  const created = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        postId,
        userId: session.user.id,
        parentId: resolvedParentId,
        bodyMarkdown: body,
        processedHtml,
        depth,
      },
      select: { id: true },
    });
    await tx.post.update({
      where: { id: postId },
      data: { commentsCount: { increment: 1 } },
    });
    return comment;
  });

  await enqueueNotification({
    type: "NEW_COMMENT",
    actorId: session.user.id,
    postId,
    commentId: created.id,
  });

  await invalidate(cacheKeys.post(post.slug));
  revalidatePath(`/${post.user.username}/${post.slug}`);
  return { ok: true };
}

/**
 * Delete own comment. The row is kept and its body replaced with a tombstone
 * (PRD §5.6) so replies underneath it survive — removing the row would orphan
 * or cascade-delete an entire subthread.
 */
export async function deleteComment(commentId: string): Promise<CommentResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      userId: true,
      bodyMarkdown: true,
      post: { select: { slug: true, user: { select: { username: true } } } },
    },
  });
  if (!comment) return { ok: false, error: "Comment not found." };
  if (comment.userId !== session.user.id) {
    return { ok: false, error: "You can only delete your own comments." };
  }
  if (comment.bodyMarkdown === TOMBSTONE) return { ok: true }; // already gone

  // commentsCount is deliberately NOT decremented: the tombstoned comment still
  // occupies a slot in the thread and is still rendered, so the visible count
  // should keep including it. reconcile-counters counts rows for the same
  // reason, which keeps the two definitions consistent.
  await prisma.comment.update({
    where: { id: commentId },
    data: { bodyMarkdown: TOMBSTONE, processedHtml: `<p>${TOMBSTONE}</p>` },
  });

  await invalidate(cacheKeys.post(comment.post.slug));
  revalidatePath(`/${comment.post.user.username}/${comment.post.slug}`);
  return { ok: true };
}
