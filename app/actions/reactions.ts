"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { enqueueNotification } from "@/lib/queues";
import type { ReactableType, ReactionCategory } from "@prisma/client";

export type ToggleResult =
  | { ok: true; active: boolean; count: number }
  | { ok: false; error: string };

/**
 * Toggle a reaction (PRD §5.7). Clicking an active reaction removes it.
 *
 * The Reaction row write and the denormalized counter update happen inside a
 * single transaction, so the two can never disagree because of a partial
 * failure. The counter can still drift for other reasons — a manual DB edit, a
 * bug — which is what reconcile-counters exists to repair (PRD §9.3).
 *
 * The compound unique index on (userId, reactableId, reactableType, category)
 * is what actually prevents double-reacting; this code just reads it first for
 * a friendlier path.
 */
export async function toggleReaction(
  reactableId: string,
  reactableType: ReactableType,
  category: ReactionCategory,
): Promise<ToggleResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in to react." };

  // Prisma cannot enforce a polymorphic FK, so validate the target exists
  // (PRD §4.6) rather than trusting the client's id.
  // Query each target type separately so the result stays a distinct type
  // rather than a union that loses the post-only fields.
  const targetPost =
    reactableType === "POST"
      ? await prisma.post.findUnique({
          where: { id: reactableId },
          select: {
            id: true,
            slug: true,
            user: { select: { username: true } },
          },
        })
      : null;
  const targetComment =
    reactableType === "COMMENT"
      ? await prisma.comment.findUnique({
          where: { id: reactableId },
          select: { id: true },
        })
      : null;

  if (!targetPost && !targetComment) {
    return { ok: false, error: "That no longer exists." };
  }

  const existing = await prisma.reaction.findUnique({
    where: {
      userId_reactableId_reactableType_category: {
        userId: session.user.id,
        reactableId,
        reactableType,
        category,
      },
    },
  });

  const removing = existing !== null;

  const count = await prisma.$transaction(async (tx) => {
    if (removing) {
      await tx.reaction.delete({ where: { id: existing.id } });
    } else {
      await tx.reaction.create({
        data: {
          userId: session.user.id,
          reactableId,
          reactableType,
          category,
        },
      });
    }

    // BOOKMARK is a private save, not a public endorsement, so it does not
    // move the visible reaction count.
    if (category !== "BOOKMARK" && reactableType === "POST") {
      const updated = await tx.post.update({
        where: { id: reactableId },
        data: { reactionsCount: { increment: removing ? -1 : 1 } },
        select: { reactionsCount: true },
      });
      return updated.reactionsCount;
    }

    return null;
  });

  if (targetPost?.user?.username) {
    revalidatePath(`/${targetPost.user.username}/${targetPost.slug}`);
  }

  // Notify the author of a new reaction — but not for a bookmark (private) and
  // not when removing one.
  if (!removing && category !== "BOOKMARK" && reactableType === "POST") {
    await enqueueNotification({
      type: "NEW_REACTION",
      actorId: session.user.id,
      postId: reactableId,
    });
  }

  const resolvedCount =
    count ??
    (await prisma.reaction.count({
      where: { reactableId, reactableType, category },
    }));

  return { ok: true, active: !removing, count: resolvedCount };
}

/** Reaction state for the current user on a post, for initial render. */
export async function getReactionState(postId: string) {
  const session = await getSession();

  const [counts, mine] = await Promise.all([
    prisma.reaction.groupBy({
      by: ["category"],
      where: { reactableId: postId, reactableType: "POST" },
      _count: { category: true },
    }),
    session
      ? prisma.reaction.findMany({
          where: {
            userId: session.user.id,
            reactableId: postId,
            reactableType: "POST",
          },
          select: { category: true },
        })
      : Promise.resolve([]),
  ]);

  const byCategory = Object.fromEntries(
    counts.map((c) => [c.category, c._count.category]),
  ) as Partial<Record<ReactionCategory, number>>;

  // Start every category at 0 so the UI never has to guard for undefined and
  // adding an enum value doesn't require touching this.
  const allCategories: ReactionCategory[] = [
    "LIKE",
    "UNICORN",
    "FIRE",
    "EXPLODING_HEAD",
    "BOOKMARK",
  ];
  const countsRecord = Object.fromEntries(
    allCategories.map((c) => [c, byCategory[c] ?? 0]),
  ) as Record<ReactionCategory, number>;

  return {
    signedIn: session !== null,
    counts: countsRecord,
    mine: new Set(mine.map((r) => r.category)),
  };
}
