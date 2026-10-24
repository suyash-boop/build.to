import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Encrypter, MAX_ATTEMPTS, verifyWebhookSignature, AUTO_DISABLE_AFTER } from "@bldt/core";
import { createDb, requireLocalTestDatabase, type Db } from "@bldt/db";
import type { JobClient } from "@bldt/jobs";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/context.ts";
import { deliverOutbound, fanoutOutbound, postPinned } from "../src/jobs/outbound.ts";

const db: Db = createDb(requireLocalTestDatabase(process.env.WORKER_TEST_DATABASE_URL, "WORKER_TEST_DATABASE_URL"), { max: 4 });
const encrypter = new Encrypter(Buffer.alloc(32, 7).toString("base64"));
const enqueued: { name: string; data: unknown; opts?: { dedupeId?: string; delayMs?: number } }[] = [];
const deps: WorkerDeps = {
  db,
  github: {} as WorkerDeps["github"],
  jobs: { enqueue: async (name: string, data: unknown, opts?: object) => void enqueued.push({ name, data, opts }) } as unknown as JobClient,
  log: pino({ level: "silent" }),
  encrypter,
  webOrigin: "https://bld.test",
  // The receiver below listens on 127.0.0.1.
  allowPrivateWebhooks: true,
};

// A programmable receiver.
let server: Server;
let base: string;
let respond: (n: number) => { status: number; body?: string; delayMs?: number } = () => ({ status: 200 });
const received: { headers: IncomingHttpHeaders; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      const r = respond(received.length);
      setTimeout(() => {
        res.writeHead(r.status, { "content-type": "text/plain" });
        res.end(r.body ?? "ok");
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.$disconnect();
});

const SECRET = "whsec_test_secret";
let projectId: string;
let mayaId: string;

beforeEach(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "OutboundDelivery","WebhookEndpoint","Signal","ActivityEvent","Notification","Task","ProjectMember","Project","User" RESTART IDENTITY CASCADE`);
  enqueued.length = 0;
  received.length = 0;
  respond = () => ({ status: 200 });
  const maya = await db.user.create({ data: { username: "maya", displayName: "Maya Chen" } });
  mayaId = maya.id;
  const project = await db.project.create({
    data: { ownerId: maya.id, slug: "relay", key: "RELAY", name: "Relay", members: { create: { userId: maya.id, role: "OWNER" } } },
  });
  projectId = project.id;
});

async function endpoint(over: Partial<{ url: string; format: "JSON" | "SLACK" | "DISCORD"; events: string[]; createdAt: Date }> = {}) {
  return db.webhookEndpoint.create({
    data: { projectId, url: `${base}/hook`, format: "JSON", events: [], secretEncrypted: encrypter.encrypt(SECRET), createdById: mayaId, ...over },
  });
}

async function activity(type: string, payload: Record<string, unknown>, over: { occurredAt?: Date; createdAt?: Date } = {}) {
  return db.activityEvent.create({
    data: { projectId, type, source: "BLDT", externalId: `${type}:${crypto.randomUUID()}`, trust: "PLATFORM", actorId: mayaId, payload, occurredAt: over.occurredAt ?? new Date(), ...(over.createdAt ? { createdAt: over.createdAt } : {}) },
  });
}

const deliveries = () => db.outboundDelivery.findMany({ orderBy: { createdAt: "asc" } });

describe("fan-out", () => {
  it("creates one delivery per subscribed endpoint, exactly once across runs", async () => {
    const all = await endpoint();
    const prOnly = await endpoint({ events: ["pull_request"] });
    await activity("task.completed", { identifier: "RELAY-3", title: "CI matrix" });
    await activity("github.pr_merged", { number: 12, title: "Bucket", url: "https://github.com/m/r/pull/12" });
    await activity("project.created", {}); // not part of the public contract

    expect((await fanoutOutbound(deps)).created).toBe(3);
    expect((await fanoutOutbound(deps)).created).toBe(0);
    const rows = await deliveries();
    expect(rows.filter((r) => r.endpointId === all.id).map((r) => r.event).sort()).toEqual(["pull_request.merged", "task.completed"]);
    expect(rows.filter((r) => r.endpointId === prOnly.id).map((r) => r.event)).toEqual(["pull_request.merged"]);
    expect(enqueued.filter((j) => j.name === "outbound.deliver")).toHaveLength(3);
    expect(rows[0]!.payload).toMatchObject({ project: { url: "https://bld.test/maya/relay" }, actor: { username: "maya", name: "Maya Chen" } });
  });

  it("does not replay history: events before the endpoint existed, or imported old events", async () => {
    await activity("task.created", { identifier: "RELAY-1", title: "Old" }, { createdAt: new Date(Date.now() - 60_000) });
    await endpoint();
    await activity("github.pr_merged", { number: 3, title: "Backfilled" }, { occurredAt: new Date(Date.now() - 30 * 86_400_000) });
    expect((await fanoutOutbound(deps)).created).toBe(0);
  });

  it("sends a signal once per occurrence and again when it escalates", async () => {
    await endpoint({ events: ["signal"] });
    const notifiedAt = new Date();
    const s = await db.signal.create({
      data: { projectId, type: "task.stalled", dedupeKey: "k", severity: "WARNING", title: "RELAY-1 has not moved in 6 days", data: { number: 1 }, lastSeenAt: notifiedAt, notifiedAt, notifiedSeverity: "WARNING" },
    });
    expect((await fanoutOutbound(deps)).created).toBe(1);
    expect((await fanoutOutbound(deps)).created).toBe(0);
    await db.signal.update({ where: { id: s.id }, data: { severity: "CRITICAL", notifiedAt: new Date(notifiedAt.getTime() + 1000) } });
    expect((await fanoutOutbound(deps)).created).toBe(1);
  });

  it("requeues deliveries that are due but were never picked up", async () => {
    const ep = await endpoint();
    await db.outboundDelivery.create({ data: { endpointId: ep.id, sourceKey: "lost", event: "ping", payload: {}, nextAttemptAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await fanoutOutbound(deps)).requeued).toBe(1);
  });
});

describe("delivery", () => {
  async function queued(format: "JSON" | "SLACK" | "DISCORD" = "JSON") {
    await endpoint({ format });
    await activity("task.completed", { identifier: "RELAY-3", title: "CI matrix" });
    await fanoutOutbound(deps);
    return (await deliveries())[0]!;
  }

  it("signs the exact body it sends and records the response", async () => {
    const d = await queued();
    expect(await deliverOutbound(deps, d.id)).toMatchObject({ ok: true, attempt: 1 });
    expect(received).toHaveLength(1);
    const req = received[0]!;
    expect(req.headers["x-bldt-event"]).toBe("task.completed");
    expect(req.headers["x-bldt-delivery"]).toBe(d.id);
    expect(req.headers["user-agent"]).toMatch(/^bld\.t-Webhooks/);
    expect(verifyWebhookSignature(SECRET, req.body, String(req.headers["x-bldt-signature"]))).toBe(true);
    expect(JSON.parse(req.body)).toMatchObject({ type: "task.completed", url: "https://bld.test/maya/relay/tasks?task=3" });
    const after = (await deliveries())[0]!;
    expect(after).toMatchObject({ status: "SUCCESS", attempts: 1, responseStatus: 200, responseBody: "ok" });
    expect((await db.webhookEndpoint.findFirstOrThrow()).lastSuccessAt).not.toBeNull();

    // Already delivered: a duplicate job does nothing.
    expect(await deliverOutbound(deps, d.id)).toBeNull();
    expect(received).toHaveLength(1);
  });

  it("formats for Slack", async () => {
    const d = await queued("SLACK");
    await deliverOutbound(deps, d.id);
    expect(JSON.parse(received[0]!.body).text).toBe("*Relay* · Maya Chen completed <https://bld.test/maya/relay/tasks?task=3|RELAY-3 CI matrix>");
  });

  it("retries on failure with backoff, then gives up after the last attempt", async () => {
    respond = () => ({ status: 503, body: "busy" });
    const d = await queued();
    enqueued.length = 0;
    const r1 = await deliverOutbound(deps, d.id);
    expect(r1).toMatchObject({ ok: false, attempt: 1, final: false });
    let row = (await deliveries())[0]!;
    expect(row).toMatchObject({ status: "PENDING", attempts: 1, responseStatus: 503, responseBody: "busy", error: "HTTP 503" });
    expect(enqueued).toEqual([{ name: "outbound.deliver", data: { deliveryId: d.id }, opts: { dedupeId: `${d.id}:1`, delayMs: 30_000 } }]);

    // Not due yet: a stray early job is ignored.
    expect(await deliverOutbound(deps, d.id)).toBeNull();

    // Fast-forward through the remaining attempts.
    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      await db.outboundDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date() } });
      await deliverOutbound(deps, d.id);
    }
    row = (await deliveries())[0]!;
    expect(row).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
    expect(received).toHaveLength(MAX_ATTEMPTS);
  });

  it("claims each attempt once even when two workers run it together", async () => {
    respond = () => ({ status: 200, delayMs: 100 });
    const d = await queued();
    const results = await Promise.all([deliverOutbound(deps, d.id), deliverOutbound(deps, d.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(received).toHaveLength(1);
  });

  it("disables an endpoint that answers 410 and tells the maintainers", async () => {
    respond = () => ({ status: 410 });
    const d = await queued();
    await db.outboundDelivery.create({ data: { endpointId: d.endpointId, sourceKey: "other", event: "ping", payload: {}, nextAttemptAt: new Date(Date.now() + 60_000) } });
    await deliverOutbound(deps, d.id);
    const ep = await db.webhookEndpoint.findFirstOrThrow();
    expect(ep).toMatchObject({ active: false, disabledReason: "The receiver answered 410 Gone" });
    expect((await deliveries()).every((x) => x.status === "FAILED")).toBe(true);
    const [n] = await db.notification.findMany({ where: { recipientId: mayaId } });
    expect(n).toMatchObject({ type: "webhook.disabled" });
  });

  it(`disables after ${AUTO_DISABLE_AFTER} deliveries in a row fail for good, not on retries`, async () => {
    respond = () => ({ status: 500 });
    const d = await queued();
    await db.webhookEndpoint.update({ where: { id: d.endpointId }, data: { consecutiveFailures: AUTO_DISABLE_AFTER - 1 } });
    // A failed attempt with retries left does not count against the endpoint.
    await deliverOutbound(deps, d.id);
    expect(await db.webhookEndpoint.findFirstOrThrow()).toMatchObject({ active: true, consecutiveFailures: AUTO_DISABLE_AFTER - 1 });
    // The last attempt failing does.
    await db.outboundDelivery.update({ where: { id: d.id }, data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date() } });
    await deliverOutbound(deps, d.id);
    expect(await db.webhookEndpoint.findFirstOrThrow()).toMatchObject({ active: false, disabledReason: expect.stringContaining("deliveries in a row failed") });
  });

  it("blocks private addresses outside development, without sending anything", async () => {
    const d = await queued();
    const strict = { ...deps, allowPrivateWebhooks: false };
    await deliverOutbound(strict, d.id);
    expect(received).toHaveLength(0);
    expect((await deliveries())[0]).toMatchObject({ status: "FAILED", error: expect.stringMatching(/^Blocked: .*webhook URLs must use https/i) });
    expect(await db.webhookEndpoint.findFirstOrThrow()).toMatchObject({ active: false });
  });
});

describe("postPinned", () => {
  const target = () => {
    const url = new URL(`${base}/x`);
    return { url, address: "127.0.0.1", family: 4 as const };
  };

  it("times out slow receivers", async () => {
    respond = () => ({ status: 200, delayMs: 1_000 });
    const r = await postPinned(target(), "{}", {}, 200);
    expect(r).toMatchObject({ ok: false, status: null });
    expect(r.error).toMatch(/Timed out/);
  });

  it("keeps only the first 2 KB of a response", async () => {
    respond = () => ({ status: 500, body: "x".repeat(100_000) });
    const r = await postPinned(target(), "{}", {});
    expect(r.body).toHaveLength(2048);
  });

  it("connects to the pinned address, not whatever the host name resolves to now", async () => {
    const url = new URL(`${base.replace("127.0.0.1", "rebind.invalid")}/x`);
    const r = await postPinned({ url, address: "127.0.0.1", family: 4 }, "{}", {});
    expect(r.ok).toBe(true);
    expect(received.at(-1)!.headers.host).toMatch(/^rebind\.invalid:/);
  });
});
