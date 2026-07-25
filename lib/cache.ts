import { redis } from "@/lib/redis";

/**
 * Cache helpers (PRD §6.4). Every cached value is JSON. Three deliberate
 * patterns use these:
 *   - TTL:                  feed:latest:page:{n}  — 60s expiry, no invalidation
 *   - Explicit invalidation: post:{slug}          — deleted on edit / new comment
 *   - Write-behind:          views:post:{id}       — INCR, flushed periodically
 *
 * NEVER cache user-specific data under a shared key: a cached feed page or post
 * is served to everyone, so it must not contain viewer-specific state.
 */

/**
 * Read-through cache. Returns the cached value if present; otherwise runs
 * `fetcher`, stores the result under `key` with `ttlSeconds`, and returns it.
 *
 * A Redis outage degrades to calling the fetcher directly — the cache is an
 * optimization, never a hard dependency.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) {
      return JSON.parse(hit) as T;
    }
  } catch {
    // Fall through to the fetcher on any cache read error.
  }

  const value = await fetcher();

  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // A failed cache write is non-fatal.
  }

  return value;
}

/** Delete one or more cache keys (explicit invalidation). */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    // Non-fatal: a stale key will expire or be overwritten.
  }
}

/**
 * Write-behind view counting (PRD §6.4). Each view does a cheap Redis INCR
 * rather than a Postgres write; flush-view-counts drains these into the DB
 * every 5 minutes. A lost increment on a Redis blip is acceptable for a view
 * count — it is a soft metric, not money.
 */
export async function incrementViews(postId: string): Promise<void> {
  try {
    await redis.incr(cacheKeys.postViews(postId));
  } catch {
    // A missed view is fine.
  }
}

/** Delete every key matching a glob pattern (e.g. "feed:latest:page:*"). */
export async function invalidatePattern(pattern: string): Promise<void> {
  try {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");

    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // Non-fatal.
  }
}

// ── Cache keys ──────────────────────────────────────────────────────────────

export const cacheKeys = {
  feedPage: (page: number) => `feed:latest:page:${page}`,
  feedPattern: () => "feed:latest:page:*",
  post: (slug: string) => `post:${slug}`,
  postViews: (postId: string) => `views:post:${postId}`,
};

export const TTL = {
  feed: 60, // §6.4: 60s
  post: 300, // 5 min; also invalidated explicitly on write
};
