import { prisma } from "@/lib/prisma";

/**
 * Recompute denormalized counters from the source rows and correct any drift
 * (PRD §6.5, §9.3).
 *
 * The counters are a cache. They are written transactionally alongside the rows
 * they count, but they can still drift — a manual DB edit, a bug, a restore
 * from backup. Rather than pretending drift cannot happen, the design assumes
 * it and repairs on a schedule: the fast path may lie, the slow path tells the
 * truth.
 *
 * Definitions must match what the UI shows:
 *  - post.reactionsCount excludes BOOKMARK (a private save, not an endorsement)
 *  - post.commentsCount counts every comment row, including tombstoned ones,
 *    because those still render in the thread
 *  - tag.postsCount and user.postsCount count published posts only
 */
export async function reconcileCounters() {
  const fixes: string[] = [];

  // ── Post.reactionsCount ───────────────────────────────────────────────────
  const reactionTruth = await prisma.reaction.groupBy({
    by: ["reactableId"],
    where: { reactableType: "POST", category: { not: "BOOKMARK" } },
    _count: { _all: true },
  });
  const trueReactions = new Map(
    reactionTruth.map((r) => [r.reactableId, r._count._all]),
  );

  // ── Post.commentsCount ────────────────────────────────────────────────────
  const commentTruth = await prisma.comment.groupBy({
    by: ["postId"],
    _count: { _all: true },
  });
  const trueComments = new Map(
    commentTruth.map((c) => [c.postId, c._count._all]),
  );

  const posts = await prisma.post.findMany({
    select: {
      id: true,
      reactionsCount: true,
      commentsCount: true,
      published: true,
      userId: true,
    },
  });

  for (const post of posts) {
    const reactions = trueReactions.get(post.id) ?? 0;
    const comments = trueComments.get(post.id) ?? 0;
    const data: { reactionsCount?: number; commentsCount?: number } = {};

    if (post.reactionsCount !== reactions) data.reactionsCount = reactions;
    if (post.commentsCount !== comments) data.commentsCount = comments;

    if (Object.keys(data).length > 0) {
      await prisma.post.update({ where: { id: post.id }, data });
      fixes.push(
        `post ${post.id}: ${JSON.stringify({
          reactionsCount: [post.reactionsCount, reactions],
          commentsCount: [post.commentsCount, comments],
        })}`,
      );
    }
  }

  // ── Tag.postsCount (published posts only) ─────────────────────────────────
  const tagTruth = await prisma.postTag.groupBy({
    by: ["tagId"],
    where: { post: { published: true } },
    _count: { _all: true },
  });
  const trueTags = new Map(tagTruth.map((t) => [t.tagId, t._count._all]));

  const tags = await prisma.tag.findMany({
    select: { id: true, name: true, postsCount: true },
  });
  for (const tag of tags) {
    const truth = trueTags.get(tag.id) ?? 0;
    if (tag.postsCount !== truth) {
      await prisma.tag.update({
        where: { id: tag.id },
        data: { postsCount: truth },
      });
      fixes.push(`tag ${tag.name}: ${tag.postsCount} → ${truth}`);
    }
  }

  // ── User.postsCount (published posts only) ────────────────────────────────
  const userTruth = new Map<string, number>();
  for (const post of posts) {
    if (!post.published) continue;
    userTruth.set(post.userId, (userTruth.get(post.userId) ?? 0) + 1);
  }

  const users = await prisma.user.findMany({
    select: { id: true, username: true, postsCount: true },
  });
  for (const user of users) {
    const truth = userTruth.get(user.id) ?? 0;
    if (user.postsCount !== truth) {
      await prisma.user.update({
        where: { id: user.id },
        data: { postsCount: truth },
      });
      fixes.push(`user ${user.username}: ${user.postsCount} → ${truth}`);
    }
  }

  return { checked: posts.length + tags.length + users.length, fixes };
}
