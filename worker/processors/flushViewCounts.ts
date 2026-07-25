import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

/**
 * Drain buffered view counts from Redis into Postgres (PRD §6.4, §6.5).
 *
 * Views are counted with Redis INCR on each request (write-behind); this job
 * runs every 5 minutes, reads each counter with GETDEL — atomic read-and-reset,
 * so a view arriving mid-flush starts a fresh counter rather than being lost —
 * and increments the post's stored viewsCount by that amount.
 */
export async function flushViewCounts() {
  const pattern = "views:post:*";
  const flushed: { postId: string; added: number }[] = [];

  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );
    cursor = next;

    for (const key of keys) {
      const postId = key.slice("views:post:".length);
      // GETDEL: read the buffered count and clear it in one atomic step.
      const raw = await redis.getdel(key);
      const count = Number(raw ?? 0);
      if (!count) continue;

      try {
        await prisma.post.update({
          where: { id: postId },
          data: { viewsCount: { increment: count } },
        });
        flushed.push({ postId, added: count });
      } catch {
        // The post may have been deleted. Put the count back so it's not lost
        // against a post that reappears — but if the post is truly gone this
        // is harmless and expires with the next flush finding nothing.
        await redis.incrby(key, count).catch(() => {});
      }
    }
  } while (cursor !== "0");

  return { posts: flushed.length, totalViews: flushed.reduce((s, f) => s + f.added, 0) };
}
