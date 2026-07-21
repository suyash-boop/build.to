"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { enqueueNotification } from "@/lib/queues";
import type { FollowableType } from "@prisma/client";

export type FollowResult =
  | { ok: true; following: boolean }
  | { ok: false; error: string };

/**
 * Toggle a follow (PRD §4.7). One polymorphic table serves both "follow a
 * person" and "follow a topic"; the compound unique on
 * (followerId, followableId, followableType) prevents duplicates.
 */
export async function toggleFollow(
  followableId: string,
  followableType: FollowableType,
): Promise<FollowResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in to follow." };

  if (followableType === "USER" && followableId === session.user.id) {
    return { ok: false, error: "You cannot follow yourself." };
  }

  // Prisma cannot enforce the polymorphic FK — verify the target exists.
  const exists =
    followableType === "USER"
      ? await prisma.user.findUnique({
          where: { id: followableId },
          select: { id: true, username: true },
        })
      : await prisma.tag.findUnique({
          where: { id: followableId },
          select: { id: true, name: true },
        });
  if (!exists) return { ok: false, error: "That no longer exists." };

  const existing = await prisma.follow.findUnique({
    where: {
      followerId_followableId_followableType: {
        followerId: session.user.id,
        followableId,
        followableType,
      },
    },
  });

  if (existing) {
    await prisma.follow.delete({ where: { id: existing.id } });
  } else {
    await prisma.follow.create({
      data: {
        followerId: session.user.id,
        followableId,
        followableType,
      },
    });
    // Only a new follow of a USER notifies; following a tag has no recipient.
    if (followableType === "USER") {
      await enqueueNotification({
        type: "NEW_FOLLOWER",
        actorId: session.user.id,
        targetUserId: followableId,
      });
    }
  }

  if (followableType === "USER" && "username" in exists && exists.username) {
    revalidatePath(`/${exists.username}`);
  } else if (followableType === "TAG" && "name" in exists) {
    revalidatePath(`/t/${exists.name}`);
  }

  return { ok: true, following: !existing };
}

/** Whether the current user follows a given target. */
export async function isFollowing(
  followableId: string,
  followableType: FollowableType,
): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followableId_followableType: {
        followerId: session.user.id,
        followableId,
        followableType,
      },
    },
    select: { id: true },
  });
  return follow !== null;
}
