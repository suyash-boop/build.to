import { prisma } from "@/lib/prisma";
import { TOMBSTONE } from "@/lib/comment-constants";

export interface ProfileStats {
  postsCount: number;
  commentsCount: number;
  tagsFollowedCount: number;
}

/** Aggregate counts shown in the profile sidebar (like dev.to's stat row). */
export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const [postsCount, commentsCount, tagsFollowedCount] = await Promise.all([
    prisma.post.count({ where: { userId, published: true } }),
    prisma.comment.count({
      where: { userId, bodyMarkdown: { not: TOMBSTONE } },
    }),
    prisma.follow.count({
      where: { followerId: userId, followableType: "TAG" },
    }),
  ]);
  return { postsCount, commentsCount, tagsFollowedCount };
}

export interface RecentComment {
  id: string;
  html: string;
  createdAt: Date;
  post: { title: string; slug: string; authorUsername: string | null };
}

/** A user's recent (non-deleted) comments, for the profile's Recent comments. */
export async function getRecentComments(
  userId: string,
  take = 8,
): Promise<RecentComment[]> {
  const comments = await prisma.comment.findMany({
    where: { userId, bodyMarkdown: { not: TOMBSTONE } },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      processedHtml: true,
      createdAt: true,
      post: {
        select: {
          title: true,
          slug: true,
          user: { select: { username: true } },
        },
      },
    },
  });

  return comments.map((c) => ({
    id: c.id,
    html: c.processedHtml,
    createdAt: c.createdAt,
    post: {
      title: c.post.title,
      slug: c.post.slug,
      authorUsername: c.post.user.username,
    },
  }));
}
