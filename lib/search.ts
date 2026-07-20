import { prisma } from "@/lib/prisma";

/**
 * Postgres full-text search over posts (PRD §5.9 — no Elasticsearch).
 *
 * `searchVector` is a generated, weighted tsvector (title A, description B,
 * body C), so title matches outrank body matches. Prisma has no tsvector type,
 * so this goes through raw SQL.
 *
 * websearch_to_tsquery is used rather than plainto_tsquery because it accepts
 * user-facing syntax — quoted phrases, OR, and leading `-` to exclude — and
 * never throws on malformed input, which matters for a public search box.
 */

export interface SearchResult {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  readingTime: number;
  reactionsCount: number;
  commentsCount: number;
  publishedAt: Date | null;
  authorName: string;
  authorUsername: string | null;
  authorImage: string | null;
  rank: number;
}

export async function searchPosts(
  query: string,
  limit = 20,
  offset = 0,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.$queryRaw<SearchResult[]>`
    SELECT
      p.id,
      p.title,
      p.slug,
      p.description,
      p."coverImage",
      p."readingTime",
      p."reactionsCount",
      p."commentsCount",
      p."publishedAt",
      u.name       AS "authorName",
      u.username   AS "authorUsername",
      COALESCE(u."profileImage", u.image) AS "authorImage",
      ts_rank(p."searchVector", websearch_to_tsquery('english', ${trimmed})) AS rank
    FROM "post" p
    JOIN "user" u ON u.id = p."userId"
    WHERE p.published = true
      AND p."searchVector" @@ websearch_to_tsquery('english', ${trimmed})
    ORDER BY rank DESC, p."publishedAt" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function countSearchResults(query: string): Promise<number> {
  const trimmed = query.trim();
  if (!trimmed) return 0;

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
    FROM "post" p
    WHERE p.published = true
      AND p."searchVector" @@ websearch_to_tsquery('english', ${trimmed})
  `;
  return Number(rows[0]?.count ?? 0);
}
