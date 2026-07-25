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

function createRedis() {
  const client = new Redis(redisUrl!, {
    // Keep retrying instead of throwing if Valkey isn't up yet at boot.
    retryStrategy: (times) => Math.min(times * 200, 2000),
    maxRetriesPerRequest: 3,
  });
  // An 'error' event with no listener crashes the Node process. Log and let the
  // retry strategy reconnect instead of taking the web server down when Valkey
  // blips.
  client.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });
  return client;
}

export const redis = globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
