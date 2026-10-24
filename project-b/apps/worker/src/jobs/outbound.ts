import http from "node:http";
import https from "node:https";
import {
  activityEnvelope,
  AUTO_DISABLE_AFTER,
  formatBody,
  MAX_ATTEMPTS,
  notify,
  projectUrl,
  publicEvent,
  RETRY_DELAYS_MS,
  signalEnvelope,
  signWebhook,
  DnsLookupError,
  UnsafeUrlError,
  vetWebhookUrl,
  wantsCategory,
  type VettedTarget,
  type WebhookEnvelope,
} from "@bldt/core";
import type { Prisma } from "@bldt/db";
import type { WorkerDeps } from "../context.ts";

/** How far back fan-out looks. Wider than the schedule so a slow or missed run loses nothing. */
const FANOUT_WINDOW_MS = 15 * 60 * 1000;
/** Imported history (a first repository sync) is not news; only recent events are sent. */
const MAX_EVENT_AGE_MS = 6 * 3600 * 1000;
const EVENT_PAGE = 2000;
const MAX_EVENT_PAGES = 25;
/** A claimed attempt that never finished (worker crash) becomes due again after this. */
const LEASE_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2048;
export const USER_AGENT = "bld.t-Webhooks/1.0";

/**
 * Turn recent activity and signals into deliveries. Idempotent by construction: the unique
 * (endpoint, sourceKey) index means overlapping runs, replicas and retries create each delivery once.
 */
export async function fanoutOutbound(deps: WorkerDeps, now = new Date()) {
  const { db, jobs } = deps;
  const endpoints = await db.webhookEndpoint.findMany({
    where: { active: true, project: { deletedAt: null } },
    include: { project: { select: { id: true, name: true, slug: true, owner: { select: { username: true } } } } },
  });

  let created = 0;
  if (endpoints.length) {
    const byProject = new Map<string, typeof endpoints>();
    for (const e of endpoints) byProject.set(e.projectId, [...(byProject.get(e.projectId) ?? []), e]);
    const projectIds = [...byProject.keys()];
    const since = new Date(now.getTime() - FANOUT_WINDOW_MS);

    const ref = (e: (typeof endpoints)[number]) => ({
      id: e.project.id,
      name: e.project.name,
      slug: e.project.slug,
      owner: e.project.owner.username,
      url: projectUrl(deps.webOrigin, e.project.owner.username, e.project.slug),
    });
    const insert = async (rows: Prisma.OutboundDeliveryCreateManyInput[]) => {
      if (!rows.length) return;
      const inserted = await db.outboundDelivery.createManyAndReturn({ data: rows, skipDuplicates: true, select: { id: true } });
      created += inserted.length;
      for (const d of inserted) await jobs.enqueue("outbound.deliver", { deliveryId: d.id }, { dedupeId: d.id });
    };

    // Keyset pages over the whole window: a burst larger than one page must not starve what came after it.
    let cursor: { createdAt: Date; id: string } | null = null;
    for (let page = 0; page < MAX_EVENT_PAGES; page++) {
      const events: Awaited<ReturnType<typeof eventPage>> = await eventPage(cursor);
      const rows: Prisma.OutboundDeliveryCreateManyInput[] = [];
      for (const ev of events) {
        const pub = publicEvent(ev.type);
        if (!pub) continue;
        for (const ep of byProject.get(ev.projectId) ?? []) {
          // Endpoints receive what happens after they exist, not a replay of the past.
          if (ev.createdAt < ep.createdAt || !wantsCategory(ep.events, pub.category)) continue;
          const env = activityEnvelope({
            id: ev.id,
            type: ev.type,
            payload: ev.payload as Record<string, unknown>,
            occurredAt: ev.occurredAt,
            project: ref(ep),
            actor: ev.actor || ev.actorLogin ? { username: ev.actor?.username ?? null, name: ev.actor?.displayName ?? null, githubLogin: ev.actorLogin } : null,
          });
          if (env) rows.push({ endpointId: ep.id, sourceKey: `activity:${ev.id}`, event: env.type, payload: env as unknown as Prisma.InputJsonValue, nextAttemptAt: now });
        }
      }
      await insert(rows);
      if (events.length < EVENT_PAGE) break;
      const last = events[events.length - 1]!;
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    function eventPage(after: { createdAt: Date; id: string } | null) {
      return db.activityEvent.findMany({
        where: {
          projectId: { in: projectIds },
          createdAt: { gte: since },
          occurredAt: { gte: new Date(now.getTime() - MAX_EVENT_AGE_MS) },
          ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}),
        },
        include: { actor: { select: { username: true, displayName: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: EVENT_PAGE,
      });
    }

    const signals = await db.signal.findMany({
      where: { projectId: { in: projectIds }, notifiedAt: { gte: since }, resolvedAt: null, severity: { in: ["WARNING", "CRITICAL"] } },
      orderBy: [{ notifiedAt: "asc" }, { id: "asc" }],
      take: 5000,
    });
    const rows: Prisma.OutboundDeliveryCreateManyInput[] = [];
    for (const s of signals) {
      for (const ep of byProject.get(s.projectId) ?? []) {
        if (s.notifiedAt! < ep.createdAt || !wantsCategory(ep.events, "signal")) continue;
        const env = signalEnvelope({ id: s.id, notifiedAt: s.notifiedAt!, signalType: s.type, severity: s.severity, title: s.title, data: s.data as Record<string, unknown>, project: ref(ep) });
        rows.push({ endpointId: ep.id, sourceKey: `signal:${s.id}:${s.notifiedAt!.getTime()}`, event: env.type, payload: env as unknown as Prisma.InputJsonValue, nextAttemptAt: now });
      }
    }
    await insert(rows);
  }

  // Safety net: anything due but not queued (Redis restart, crashed worker) is queued again.
  const overdue = await db.outboundDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lt: new Date(now.getTime() - LEASE_MS) } },
    select: { id: true },
    take: 500,
  });
  for (const d of overdue) await jobs.enqueue("outbound.deliver", { deliveryId: d.id }, { dedupeId: d.id });

  if (created || overdue.length) deps.log.info({ created, requeued: overdue.length }, "outbound fan-out");
  return { created, requeued: overdue.length };
}

export interface SendResult {
  ok: boolean;
  status: number | null;
  body: string | null;
  error: string | null;
  durationMs: number;
  /** The receiver says the endpoint is gone for good. */
  gone: boolean;
}

/** POST to a vetted address. The connection goes to that IP (no second DNS lookup); redirects are not followed. */
export function postPinned(target: VettedTarget, body: string, headers: Record<string, string>, timeoutMs = TIMEOUT_MS): Promise<SendResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: Omit<SendResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({ ...r, durationMs: Date.now() - started });
    };
    const mod = target.url.protocol === "https:" ? https : http;
    const req = mod.request(target.url, {
      method: "POST",
      agent: false,
      headers: { ...headers, "content-length": Buffer.byteLength(body).toString() },
      lookup: (_host, opts, cb) => {
        if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: target.address, family: target.family }]);
        else cb(null, target.address, target.family);
      },
    });
    // One deadline for connect, TLS, upload and response together.
    const deadline = setTimeout(() => {
      req.destroy(new Error(`Timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    req.on("error", (err) => done({ ok: false, status: null, body: null, error: err.message, gone: false }));
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = () => {
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString("utf8").slice(0, MAX_RESPONSE_BYTES);
        done({ ok: status >= 200 && status < 300, status, body: text || null, error: status >= 200 && status < 300 ? null : `HTTP ${status}`, gone: status === 410 });
        res.destroy();
      };
      res.on("data", (c: Buffer) => {
        if (size < MAX_RESPONSE_BYTES) chunks.push(c);
        size += c.length;
        // Only the start of the body is kept; stop reading a large or endless response.
        if (size >= MAX_RESPONSE_BYTES) finish();
      });
      res.on("end", finish);
      res.on("error", (err) => done({ ok: false, status: res.statusCode ?? null, body: null, error: err.message, gone: false }));
    });
    req.end(body);
  });
}

export async function deliverOutbound(deps: WorkerDeps, deliveryId: string, now = new Date()) {
  const { db, jobs } = deps;
  const d = await db.outboundDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
  if (!d || d.status !== "PENDING") return null;
  // Test pings still go out to a disabled endpoint, so a fix can be checked before re-enabling.
  if (!d.endpoint.active && !d.sourceKey.startsWith("ping:")) {
    await db.outboundDelivery.update({ where: { id: d.id }, data: { status: "FAILED", completedAt: now, error: "Endpoint is disabled", nextAttemptAt: null } });
    return null;
  }
  // Not due yet: an early duplicate job (the real one is scheduled).
  if (d.nextAttemptAt && d.nextAttemptAt.getTime() > now.getTime() + 1000) return null;

  // Claim this attempt. A concurrent worker with the same job loses the race and does nothing.
  const { count } = await db.outboundDelivery.updateMany({
    where: { id: d.id, status: "PENDING", attempts: d.attempts },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (count === 0) return null;
  const attempt = d.attempts + 1;

  const envelope = d.payload as unknown as WebhookEnvelope;
  const body = formatBody(d.endpoint.format, envelope);
  let result: SendResult;
  try {
    const target = await vetWebhookUrl(d.endpoint.url, { allowPrivate: deps.allowPrivateWebhooks });
    const secret = deps.encrypter.decrypt(d.endpoint.secretEncrypted);
    result = await postPinned(target, body, {
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      "x-bldt-event": envelope.type,
      "x-bldt-delivery": d.id,
      "x-bldt-signature": signWebhook(secret, body),
    });
  } catch (err) {
    // Unsafe URLs never improve by retrying; DNS trouble usually does; other errors here are ours (decrypt).
    const unsafe = err instanceof UnsafeUrlError;
    const dns = err instanceof DnsLookupError;
    result = { ok: false, status: null, body: null, error: unsafe ? `Blocked: ${err.message}` : dns ? err.message : "Internal error preparing the request", durationMs: 0, gone: unsafe };
    if (!unsafe && !dns) deps.log.error({ err, deliveryId }, "outbound delivery setup failed");
  }

  const response = { responseStatus: result.status, responseBody: result.body, error: result.error, durationMs: result.durationMs };
  if (result.ok) {
    await db.$transaction([
      db.outboundDelivery.update({ where: { id: d.id }, data: { ...response, status: "SUCCESS", completedAt: new Date(), nextAttemptAt: null } }),
      db.webhookEndpoint.update({ where: { id: d.endpointId }, data: { consecutiveFailures: 0, lastDeliveryAt: new Date(), lastSuccessAt: new Date() } }),
    ]);
    return { ok: true, attempt };
  }

  const finalAttempt = result.gone || attempt >= MAX_ATTEMPTS;
  const delay = RETRY_DELAYS_MS[attempt - 1] ?? 0;
  await db.outboundDelivery.update({
    where: { id: d.id },
    data: finalAttempt
      ? { ...response, status: "FAILED", completedAt: new Date(), nextAttemptAt: null }
      : { ...response, nextAttemptAt: new Date(now.getTime() + delay) },
  });
  // The streak counts deliveries that failed for good, not attempts: a receiver down for an hour
  // should not be switched off while its retries are still pending.
  const endpoint = await db.webhookEndpoint.update({
    where: { id: d.endpointId },
    data: { ...(finalAttempt ? { consecutiveFailures: { increment: 1 } } : {}), lastDeliveryAt: new Date() },
  });
  if (!finalAttempt) await jobs.enqueue("outbound.deliver", { deliveryId: d.id }, { dedupeId: `${d.id}:${attempt}`, delayMs: delay });

  if (endpoint.active && (result.gone || endpoint.consecutiveFailures >= AUTO_DISABLE_AFTER)) await disableEndpoint(deps, d.endpointId, result);
  return { ok: false, attempt, final: finalAttempt };
}

async function disableEndpoint(deps: WorkerDeps, endpointId: string, last: SendResult) {
  const { db } = deps;
  const reason = last.gone
    ? last.error?.startsWith("Blocked") ? last.error : "The receiver answered 410 Gone"
    : `${AUTO_DISABLE_AFTER} deliveries in a row failed after every retry (last: ${last.error ?? "unknown error"})`;
  const { count } = await db.webhookEndpoint.updateMany({ where: { id: endpointId, active: true }, data: { active: false, disabledReason: reason } });
  if (count === 0) return;
  // Waiting retries would only fail again.
  await db.outboundDelivery.updateMany({ where: { endpointId, status: "PENDING" }, data: { status: "FAILED", completedAt: new Date(), error: "Endpoint was disabled", nextAttemptAt: null } });
  const ep = await db.webhookEndpoint.findUniqueOrThrow({
    where: { id: endpointId },
    include: { project: { select: { id: true, name: true, slug: true, owner: { select: { username: true } }, members: { where: { role: { in: ["OWNER", "MAINTAINER"] } }, select: { userId: true } } } } },
  });
  await notify(
    db,
    ep.project.members.map((m) => m.userId),
    "webhook.disabled",
    { projectName: ep.project.name, projectSlug: ep.project.slug, ownerUsername: ep.project.owner.username, url: ep.url, reason },
    { projectId: ep.project.id },
  );
  deps.log.warn({ endpointId, reason }, "webhook endpoint disabled");
}
