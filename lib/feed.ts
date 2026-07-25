import { prisma } from "@/lib/prisma";
import { cached, cacheKeys, TTL } from "@/lib/cache";
import type { PostCardData } from "@/components/post/PostCard";
import type { Prisma } from "@prisma/client";

export const POSTS_PER_PAGE = 20; // PRD §5.4

// Everything a PostCard needs, and nothing more — the body is deliberately not
// selected, since feed pages never render it.
const cardSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  coverImage: true,
  readingTime: true,
  reactionsCount: true,
  commentsCount: true,
  publishedAt: true,
  createdAt: true,
  user: {
    select: { name: true, username: true, profileImage: true, image: true },
  },
  tags: { select: { tag: { select: { name: true, bgColorHex: true } } } },
} satisfies Prisma.PostSelect;

type PostRow = Prisma.PostGetPayload<{ select: typeof cardSelect }>;

function toCardData(post: PostRow): PostCardData {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    description: post.description,
    coverImage: post.coverImage,
    readingTime: post.readingTime,
    reactionsCount: post.reactionsCount,
    commentsCount: post.commentsCount,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    author: {
      name: post.user.name,
      username: post.user.username,
      image: post.user.profileImage ?? post.user.image,
    },
    tags: post.tags.map((pt) => pt.tag),
  };
}

export interface FeedPage {
  posts: PostCardData[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Latest published posts, newest first (PRD §5.4). Pull-based: generated at read
 * time rather than fanned out on write — see PRD §9.2 for why.
 *
 * The un-tagged latest feed is cached with a 60s TTL (PRD §6.4): it is public
 * and identical for every visitor, so one cached page serves everyone. Tag
 * feeds are not cached under this key — they'd need per-tag keys and see far
 * less traffic.
 */
export async function getLatestFeed(
  page = 1,
  tagName?: string,
): Promise<FeedPage> {
  if (!tagName) {
    return cached(cacheKeys.feedPage(page), TTL.feed, () => queryFeed(page));
  }
  return queryFeed(page, tagName);
}

async function queryFeed(page: number, tagName?: string): Promise<FeedPage> {
  const where: Prisma.PostWhereInput = {
    published: true,
    ...(tagName ? { tags: { some: { tag: { name: tagName } } } } : {}),
  };

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      select: cardSelect,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * POSTS_PER_PAGE,
      take: POSTS_PER_PAGE,
    }),
    prisma.post.count({ where }),
  ]);

  return {
    posts: posts.map(toCardData),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / POSTS_PER_PAGE)),
  };
}
