import { CreateWebhookInput, UpdateWebhookInput, type OutboundDeliveryDetail, type OutboundDeliveryItem, type WebhookEndpointItem } from "@bldt/contracts";
import {
  formatBody,
  generateWebhookSecret,
  MAX_ENDPOINTS_PER_PROJECT,
  pingEnvelope,
  projectUrl,
  DnsLookupError,
  UnsafeUrlError,
  vetWebhookUrl,
  type WebhookEnvelope,
} from "@bldt/core";
import type { OutboundDelivery, Prisma, WebhookEndpoint } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { afterCursor, decodeCursor, page } from "../lib/cursor.ts";
import { toUserRef } from "../lib/dto.ts";
import { conflict, notFound, unprocessable } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";

const EndpointParams = ProjectParams.extend({ id: z.uuid() });
const DeliveryParams = EndpointParams.extend({ deliveryId: z.uuid() });

const userSelect = { select: { id: true, username: true, displayName: true, avatarUrl: true } } as const;
type EndpointRow = WebhookEndpoint & { createdBy: { id: string; username: string; displayName: string; avatarUrl: string | null } | null };

function toEndpoint(e: EndpointRow, recent: WebhookEndpointItem["recent"]): WebhookEndpointItem {
  return {
    id: e.id,
    url: e.url,
    format: e.format,
    description: e.description,
    events: e.events,
    active: e.active,
    disabledReason: e.disabledReason,
    consecutiveFailures: e.consecutiveFailures,
    lastDeliveryAt: e.lastDeliveryAt?.toISOString() ?? null,
    lastSuccessAt: e.lastSuccessAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    createdBy: e.createdBy ? toUserRef(e.createdBy) : null,
    recent,
  };
}

function toDelivery(d: OutboundDelivery): OutboundDeliveryItem {
  return {
    id: d.id,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    error: d.error,
    durationMs: d.durationMs,
    createdAt: d.createdAt.toISOString(),
    completedAt: d.completedAt?.toISOString() ?? null,
    nextAttemptAt: d.status === "PENDING" ? (d.nextAttemptAt?.toISOString() ?? null) : null,
  };
}

/** Webhook URLs often carry a token in the path (Slack, Discord). Show enough to recognise, not to reuse. */
export function maskUrl(raw: string) {
  try {
    const u = new URL(raw);
    // Keep the first segment (hooks.slack.com/services, discord.com/api); tokens live after it.
    const [first, ...rest] = u.pathname.split("/").filter(Boolean);
    const path = first ? `/${first}${rest.length ? "/…" : ""}` : "/";
    return `${u.protocol}//${u.host}${path}${u.search ? "?…" : ""}`;
  } catch {
    return "invalid URL";
  }
}

export const outboundWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, jobs, encrypter, env } = app.deps;
  const allowPrivate = env.WEBHOOKS_ALLOW_PRIVATE;

  async function vet(url: string) {
    try {
      return (await vetWebhookUrl(url, { allowPrivate })).url.href;
    } catch (err) {
      if (err instanceof UnsafeUrlError || err instanceof DnsLookupError) throw unprocessable(err.message, [{ path: "url", message: err.message }]);
      throw err;
    }
  }

  async function loadEndpoint(projectId: string, id: string) {
    const e = await db.webhookEndpoint.findFirst({ where: { id, projectId }, include: { createdBy: userSelect } });
    if (!e) throw notFound("Webhook not found");
    return e;
  }

  async function recentStats(ids: string[]) {
    const since = new Date(Date.now() - 86_400_000);
    const rows = ids.length
      ? await db.outboundDelivery.groupBy({ by: ["endpointId", "status"], where: { endpointId: { in: ids }, createdAt: { gte: since } }, _count: true })
      : [];
    return (id: string) => {
      const mine = rows.filter((r) => r.endpointId === id);
      const n = (s: string) => mine.find((r) => r.status === s)?._count ?? 0;
      return { total: mine.reduce((a, r) => a + r._count, 0), failed: n("FAILED"), pending: n("PENDING") };
    };
  }

  async function enqueueDelivery(endpoint: WebhookEndpoint, sourceKey: string, envelope: WebhookEnvelope) {
    const d = await db.outboundDelivery.create({
      data: { endpointId: endpoint.id, sourceKey, event: envelope.type, payload: envelope as unknown as Prisma.InputJsonValue, nextAttemptAt: new Date() },
    });
    await jobs.enqueue("outbound.deliver", { deliveryId: d.id }, { dedupeId: d.id });
    return d;
  }

  app.get("/projects/:owner/:slug/webhooks", { schema: { params: ProjectParams } }, async (req) => {
    const { project } = await authorize(db, req.params, requireViewer(req), "project.integrations");
    const rows = await db.webhookEndpoint.findMany({ where: { projectId: project.id }, include: { createdBy: userSelect }, orderBy: { createdAt: "asc" } });
    const stats = await recentStats(rows.map((r) => r.id));
    return { items: rows.map((r) => toEndpoint(r, stats(r.id))) };
  });

  app.post("/projects/:owner/:slug/webhooks", { schema: { params: ProjectParams, body: CreateWebhookInput } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "project.integrations");
    if ((await db.webhookEndpoint.count({ where: { projectId: project.id } })) >= MAX_ENDPOINTS_PER_PROJECT) {
      throw conflict(`A project can have up to ${MAX_ENDPOINTS_PER_PROJECT} webhooks`);
    }
    const url = await vet(req.body.url);
    const secret = generateWebhookSecret();
    const e = await db.webhookEndpoint.create({
      data: {
        projectId: project.id,
        createdById: viewer.id,
        url,
        format: req.body.format,
        description: req.body.description || null,
        events: [...new Set(req.body.events)],
        secretEncrypted: encrypter.encrypt(secret),
      },
      include: { createdBy: userSelect },
    });
    await audit(db, req, { projectId: project.id, action: "webhook.created", targetId: e.id, metadata: { url: maskUrl(url), format: e.format } });
    // The secret is returned once. It cannot be read back, only rotated.
    return reply.status(201).send({ endpoint: toEndpoint(e, { total: 0, failed: 0, pending: 0 }), secret });
  });

  app.patch("/projects/:owner/:slug/webhooks/:id", { schema: { params: EndpointParams, body: UpdateWebhookInput } }, async (req) => {
    const { project } = await authorize(db, req.params, requireViewer(req), "project.integrations");
    const e = await loadEndpoint(project.id, req.params.id);
    const url = req.body.url !== undefined && req.body.url !== e.url ? await vet(req.body.url) : undefined;
    const enabling = req.body.active === true && !e.active;
    const updated = await db.webhookEndpoint.update({
      where: { id: e.id },
      data: {
        url,
        format: req.body.format,
        description: req.body.description === undefined ? undefined : req.body.description || null,
        events: req.body.events ? [...new Set(req.body.events)] : undefined,
        active: req.body.active,
        // Re-enabling starts the failure count over; disabling by hand records no reason.
        ...(enabling ? { consecutiveFailures: 0, disabledReason: null } : {}),
        ...(req.body.active === false ? { disabledReason: null } : {}),
      },
      include: { createdBy: userSelect },
    });
    await audit(db, req, {
      projectId: project.id,
      action: "webhook.updated",
      targetId: e.id,
      metadata: { ...req.body, ...(req.body.url ? { url: maskUrl(req.body.url) } : {}) },
    });
    return toEndpoint(updated, (await recentStats([e.id]))(e.id));
  });

  app.delete("/projects/:owner/:slug/webhooks/:id", { schema: { params: EndpointParams } }, async (req) => {
    const { project } = await authorize(db, req.params, requireViewer(req), "project.integrations");
    const e = await loadEndpoint(project.id, req.params.id);
    await db.webhookEndpoint.delete({ where: { id: e.id } });
    await audit(db, req, { projectId: project.id, action: "webhook.deleted", targetId: e.id, metadata: { url: maskUrl(e.url) } });
    return { ok: true };
  });

  app.post("/projects/:owner/:slug/webhooks/:id/rotate-secret", { schema: { params: EndpointParams } }, async (req) => {
    const { project } = await authorize(db, req.params, requireViewer(req), "project.integrations");
    const e = await loadEndpoint(project.id, req.params.id);
    const secret = generateWebhookSecret();
    await db.webhookEndpoint.update({ where: { id: e.id }, data: { secretEncrypted: encrypter.encrypt(secret) } });
    await audit(db, req, { projectId: project.id, action: "webhook.secret_rotated", targetId: e.id });
    return { secret };
  });

  // Each test or redelivery makes bld.t send a signed POST: keep it to a human pace.
  app.post("/projects/:owner/:slug/webhooks/:id/test", { schema: { params: EndpointParams }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "project.integrations");
    const e = await loadEndpoint(project.id, req.params.id);
    const owner = await db.user.findUniqueOrThrow({ where: { id: project.ownerId }, select: { username: true } });
    const id = crypto.randomUUID();
    const env = pingEnvelope(
      id,
      { id: project.id, name: project.name, slug: project.slug, owner: owner.username, url: projectUrl(`${app.deps.env.WEB_ORIGIN}/projects`, owner.username, project.slug) },
      { username: viewer.username, name: viewer.displayName, githubLogin: null },
    );
    // Tests reach disabled endpoints too (the worker allows pings): check a fix before re-enabling.
    const d = await enqueueDelivery(e, `ping:${id}`, env);
    return reply.status(202).send(toDelivery(d));
  });

  app.get(
    "/projects/:owner/:slug/webhooks/:id/deliveries",
    { schema: { params: EndpointParams, querystring: z.object({ cursor: z.string().optional(), status: z.enum(["PENDING", "SUCCESS", "FAILED"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }) } },
    async (req) => {
      const { project } = await authorize(db, req.params, requireViewer(req), "project.integrations");
      const e = await loadEndpoint(project.id, req.params.id);
      const rows = await db.outboundDelivery.findMany({
        where: { endpointId: e.id, ...(req.query.status ? { status: req.query.status } : {}), ...afterCursor("createdAt", decodeCursor(req.query.cursor)) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: req.query.limit + 1,
      });
      const p = page(rows, req.query.limit, (r) => r.createdAt);
      return { items: p.items.map(toDelivery), nextCursor: p.nextCursor };
    },
  );

  app.get("/projects/:owner/:slug/webhooks/:id/deliveries/:deliveryId", { schema: { params: DeliveryParams } }, async (req) => {
    const { project } = await authorize(db, req.params, requireViewer(req), "project.integrations");
    const e = await loadEndpoint(project.id, req.params.id);
    const d = await db.outboundDelivery.findFirst({ where: { id: req.params.deliveryId, endpointId: e.id } });
    if (!d) throw notFound("Delivery not found");
    const detail: OutboundDeliveryDetail = {
      ...toDelivery(d),
      requestBody: formatBody(e.format, d.payload as unknown as WebhookEnvelope),
      responseBody: d.responseBody,
    };
    return detail;
  });

  app.post("/projects/:owner/:slug/webhooks/:id/deliveries/:deliveryId/redeliver", { schema: { params: DeliveryParams }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { project } = await authorize(db, req.params, requireViewer(req), "project.integrations");
    const e = await loadEndpoint(project.id, req.params.id);
    if (!e.active) throw conflict("Enable the webhook before redelivering");
    const d = await db.outboundDelivery.findFirst({ where: { id: req.params.deliveryId, endpointId: e.id } });
    if (!d) throw notFound("Delivery not found");
    // Same envelope, same event id: receivers that dedupe on it treat this as the same event.
    const copy = await enqueueDelivery(e, `redeliver:${crypto.randomUUID()}`, d.payload as unknown as WebhookEnvelope);
    await audit(db, req, { projectId: project.id, action: "webhook.redelivered", targetId: e.id, metadata: { deliveryId: d.id } });
    return reply.status(202).send(toDelivery(copy));
  });
};
