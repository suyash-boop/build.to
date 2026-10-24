import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Deps } from "./context.ts";
import { AppError } from "./lib/errors.ts";
import { authPlugin } from "./plugins/auth.ts";
import { authRoutes } from "./modules/auth.ts";
import { githubRoutes } from "./modules/github.ts";
import { webhookRoutes } from "./modules/webhooks.ts";
import { projectRoutes } from "./modules/projects.ts";
import { memberRoutes } from "./modules/members.ts";
import { taskRoutes } from "./modules/tasks.ts";
import { milestoneRoutes } from "./modules/milestones.ts";
import { releaseRoutes } from "./modules/releases.ts";
import { userRoutes } from "./modules/users.ts";
import { homeRoutes } from "./modules/home.ts";
import { notificationRoutes } from "./modules/notifications.ts";
import { searchRoutes } from "./modules/search.ts";
import { discoverRoutes } from "./modules/discover.ts";
import { badgeRoutes } from "./modules/badge.ts";
import { aiRoutes } from "./modules/ai.ts";
import { insightsRoutes } from "./modules/insights.ts";
import { signalRoutes } from "./modules/signals.ts";
import { realtimeRoutes } from "./modules/realtime.ts";
import { outboundWebhookRoutes } from "./modules/outbound-webhooks.ts";
import { workRecordRoutes } from "./modules/work-records.ts";
import { deviceAuthRoutes } from "./modules/device-auth.ts";
import { discussionRoutes } from "./modules/discussions.ts";
import { presenceRoutes } from "./modules/presence.ts";

export async function buildServer(deps: Deps) {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
      ...(deps.env.isProd ? {} : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
    },
    // One hop: the web app, which forwards a single verified client address (apps/web/src/lib/client-ip.ts).
    // Never true: that would trust every X-Forwarded-For entry, including ones a client wrote.
    trustProxy: deps.env.TRUST_PROXY ? (_address: string, hop: number) => hop === 0 : false,
    bodyLimit: 1024 * 1024,
    genReqId: (req) => {
      // Accept a caller-supplied id only if it looks like one; never let clients write arbitrary log text.
      const id = req.headers["x-request-id"];
      return typeof id === "string" && /^[\w-]{1,64}$/.test(id) ? id : crypto.randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // GitHub ids are BigInt in the database; never let one reach JSON.stringify unconverted.
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
  );

  app.decorate("deps", deps);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(cookie, { secret: deps.env.COOKIE_SECRET });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    redis: deps.redis,
    // Run after the auth hook so signed-in users are limited per account, not per IP.
    hook: "preHandler",
    keyGenerator: (req) => req.viewer?.id ?? req.ip,
    allowList: (req) => req.url.startsWith("/webhooks/") || req.url === "/healthz",
  });
  await app.register(authPlugin);

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: "validation_failed",
          message: "Some fields are invalid",
          details: err.validation.map((v) => ({
            path: v.instancePath.replace(/^\//, "").replace(/\//g, "."),
            message: v.message,
          })),
        },
      });
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    // Races on unique keys (double clicks, two tabs) and rows deleted mid-request are client-facing
    // outcomes, not server faults.
    const prismaCode = (err as { code?: unknown }).code;
    if (prismaCode === "P2002") return reply.status(409).send({ error: { code: "conflict", message: "That already exists. Refresh and try again." } });
    if (prismaCode === "P2025") return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
    // Octokit errors carry the GitHub status: an expired or revoked user token means reconnecting.
    const ghStatus = (err as { name?: string; status?: number }).name === "HttpError" ? (err as { status?: number }).status : undefined;
    if (ghStatus === 401) return reply.status(401).send({ error: { code: "github_reauth", message: "Your GitHub connection expired. Sign in with GitHub again to continue." } });
    if (ghStatus === 403 || ghStatus === 404) {
      return reply.status(ghStatus).send({ error: { code: ghStatus === 404 ? "not_found" : "forbidden", message: "GitHub did not allow access to that." } });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "request failed");
    return reply.status(status).send({
      error: {
        code: status === 429 ? "rate_limited" : status >= 500 ? "internal" : "error",
        message: status >= 500 ? "Something went wrong on our side" : err.message,
      },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Route not found" } }),
  );

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_req, reply) => {
    try {
      await deps.db.$queryRaw`SELECT 1`;
      await deps.redis.ping();
      return { ok: true };
    } catch (err) {
      app.log.error({ err }, "readiness check failed");
      return reply.status(503).send({ ok: false });
    }
  });

  await app.register(authRoutes);
  await app.register(githubRoutes);
  await app.register(webhookRoutes);
  await app.register(projectRoutes);
  await app.register(memberRoutes);
  await app.register(taskRoutes);
  await app.register(milestoneRoutes);
  await app.register(releaseRoutes);
  await app.register(userRoutes);
  await app.register(homeRoutes);
  await app.register(notificationRoutes);
  await app.register(searchRoutes);
  await app.register(discoverRoutes);
  await app.register(badgeRoutes);
  await app.register(aiRoutes);
  await app.register(insightsRoutes);
  await app.register(signalRoutes);
  await app.register(realtimeRoutes);
  await app.register(outboundWebhookRoutes);
  await app.register(workRecordRoutes);
  await app.register(deviceAuthRoutes);
  await app.register(discussionRoutes);
  await app.register(presenceRoutes);

  return app;
}

export type AppInstance = Awaited<ReturnType<typeof buildServer>>;
