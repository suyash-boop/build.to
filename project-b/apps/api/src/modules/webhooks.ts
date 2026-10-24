import { HANDLED_EVENTS, verifyWebhookSignature } from "@bldt/github";
import type { FastifyPluginAsync } from "fastify";

/** A delivery accepted this long ago and never picked up by the worker was lost on the way to the queue. */
const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * GitHub webhook receiver. Verifies the signature against the raw body, stores the delivery
 * for idempotency and observability, then hands it to the worker. Responds fast; GitHub
 * times out deliveries after 10 seconds.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const { db, jobs, env } = app.deps;

  // Raw body is required for HMAC verification; scoped to this plugin only.
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 25 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/webhooks/github", { config: { rateLimit: false } }, async (req, reply) => {
    if (!env.GITHUB_WEBHOOK_SECRET) return reply.status(503).send({ error: { code: "github_not_configured", message: "The GitHub App integration is not configured." } });
    const raw = req.body as Buffer;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(env.GITHUB_WEBHOOK_SECRET, raw, signature)) {
      req.log.warn("webhook signature mismatch");
      return reply.status(401).send({ error: { code: "bad_signature", message: "Invalid signature" } });
    }

    const deliveryId = req.headers["x-github-delivery"] as string | undefined;
    const event = req.headers["x-github-event"] as string | undefined;
    if (!deliveryId || !event) return reply.status(400).send({ error: { code: "bad_request", message: "Missing headers" } });

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply.status(400).send({ error: { code: "bad_request", message: "Invalid JSON" } });
    }

    const installationId = (payload.installation as { id?: number } | undefined)?.id;
    const repoId = (payload.repository as { id?: number } | undefined)?.id;
    const handled = HANDLED_EVENTS.has(event);

    let shouldProcess = handled;
    try {
      await db.webhookDelivery.create({
        data: {
          id: deliveryId,
          event,
          action: typeof payload.action === "string" ? payload.action : null,
          installationId: installationId ? BigInt(installationId) : null,
          repositoryGithubId: repoId ? BigInt(repoId) : null,
          status: handled ? "RECEIVED" : "IGNORED",
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      // Same delivery id seen before (a manual redelivery). Process it again only if the earlier copy
      // failed, or was accepted but never reached the worker (stuck in RECEIVED past any queue delay).
      const prev = await db.webhookDelivery.findUnique({ where: { id: deliveryId }, select: { status: true, attempts: true, receivedAt: true } });
      const stuck = prev?.status === "RECEIVED" && prev.attempts === 0 && Date.now() - prev.receivedAt.getTime() > STUCK_AFTER_MS;
      shouldProcess = handled && (prev?.status === "FAILED" || stuck);
      if (shouldProcess) {
        await db.webhookDelivery.update({ where: { id: deliveryId }, data: { status: "RECEIVED", error: null } });
      }
    }

    if (shouldProcess) {
      try {
        await jobs.enqueue("webhook.process", { deliveryId, event, payload }, { dedupeId: deliveryId });
      } catch (err) {
        // Queue unavailable: record it so a redelivery from GitHub is processed, then report the failure.
        await db.webhookDelivery.update({ where: { id: deliveryId }, data: { status: "FAILED", error: "Could not queue for processing" } }).catch(() => {});
        throw err;
      }
    }
    return reply.status(202).send({ ok: true });
  });
};
