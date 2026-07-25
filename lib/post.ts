import { prisma } from "@/lib/prisma";
import { cached, cacheKeys, TTL } from "@/lib/cache";

/**
 * Public post data for the detail page — the cacheable part. Deliberately
 * excludes anything viewer-specific (reaction state, follow state, comments):
 * those are fetched separately and never cached under this shared key.
 *
 * Only READY, published posts are cached; drafts and processing posts are
 * always read fresh so their state is never served stale.
 */
export interface PublicPost {
  id: string;
  userId: string;
  title: string;
  slug: string;
  processedHtml: string | null;
  processingState: string;
  coverImage: string | null;
  description: string | null;
  published: boolean;
  readingTime: number;
  reactionsCount: number;
  commentsCount: number;
  publishedAt: string | null;
  createdAt: string;
  author: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
    profileImage: string | null;
  };
  tags: { id: string; name: string; bgColorHex: string }[];
}

async function queryPost(slug: string): Promise<PublicPost | null> {
  const post = await prisma.post.findUnique({
    where: { slug },
    select: {
      id: true,
      userId: true,
      title: true,
      slug: true,
      processedHtml: true,
      processingState: true,
      coverImage: true,
      description: true,
      published: true,
      readingTime: true,
      reactionsCount: true,
      commentsCount: true,
      publishedAt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          profileImage: true,
        },
      },
      tags: {
        select: { tag: { select: { id: true, name: true, bgColorHex: true } } },
      },
    },
  });
  if (!post) return null;

  return {
    id: post.id,
    userId: post.userId,
    title: post.title,
    slug: post.slug,
    processedHtml: post.processedHtml,
    processingState: post.processingState,
    coverImage: post.coverImage,
    description: post.description,
    published: post.published,
    readingTime: post.readingTime,
    reactionsCount: post.reactionsCount,
    commentsCount: post.commentsCount,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    author: {
      id: post.user.id,
      name: post.user.name,
      username: post.user.username,
      image: post.user.image,
      profileImage: post.user.profileImage,
    },
    tags: post.tags.map((pt) => pt.tag),
  };
}

/**
 * Fetch a post by slug, verifying it belongs to `username`. Published+READY
 * posts are cached (post:{slug}, explicit invalidation on write); everything
 * else is read fresh.
 */
export async function getPublicPost(
  username: string,
  slug: string,
): Promise<PublicPost | null> {
  const load = () => queryPost(slug);

  // Only cache the stable case. A processing/draft post read fresh avoids
  // serving a "still rendering" snapshot after the worker has finished.
  const post = await cached(cacheKeys.post(slug), TTL.post, load).catch(load);

  if (!post) return null;
  if (post.author.username !== username) return null;

  // If the cached copy is stale-looking (not yet READY), re-read fresh once.
  if (post.published && post.processingState !== "READY") {
    const fresh = await load();
    return fresh && fresh.author.username === username ? fresh : null;
  }

  return post;
}
