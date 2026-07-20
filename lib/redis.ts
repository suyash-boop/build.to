import Redis from "ioredis";

// Singleton Redis client (points at the Valkey container). Reused across hot
// reloads for the same reason as the Prisma client. This is the general-purpose
// cache connection; BullMQ configures its own connection in the worker, since it
// requires maxRetriesPerRequest: null.
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}

export const redis = globalForRedis.redis ?? new Redis(redisUrl);

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
