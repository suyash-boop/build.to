import { createDb, type Db } from "@bldt/db";
import type { FastifyBaseLogger } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_STREAMS_PER_USER, RealtimeHub, type ChangeSource, type ClientChange, type RawChange } from "../src/lib/realtime.ts";
import { client, createUser, reset, setup, TEST_DB_URL, type TestContext, type TestUser } from "./helpers.ts";

const noop = () => {};
const silent = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => silent } as unknown as FastifyBaseLogger;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FLUSHED = 220;

async function waitFor<T>(fn: () => T | undefined | false, ms = 5_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("timed out waiting");
    await sleep(25);
  }
}

describe("realtime hub", () => {
  const db: Db = createDb(TEST_DB_URL, { max: 3 });
  let emit: (c: RawChange) => void;
  let ready: (reconnected: boolean) => void;
  const source: ChangeSource = {
    start: (onChange, onReady) => {
      emit = onChange;
      ready = onReady;
    },
    stop: async () => {},
  };
  let hub: RealtimeHub;
  let maya: TestUser;
  let ari: TestUser;
  let relayId: string;

  async function connect(user: TestUser, opts: { sessionId?: string } = {}) {
    const frames: string[] = [];
    const state = { ended: false, buffered: 0 };
    const sub = await hub.subscribe({
      userId: user.id,
      sessionId: opts.sessionId ?? null,
      write: (f) => (frames.push(f), true),
      buffered: () => state.buffered,
      end: () => void (state.ended = true),
    });
    const changes = () => frames.filter((f) => f.startsWith("event: change")).flatMap((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)) as ClientChange[]);
    return { sub, frames, state, changes };
  }

  beforeAll(() => {
    hub = new RealtimeHub(db, source, silent);
    hub.start();
  });
  afterAll(async () => {
    await hub.close();
    await db.$disconnect();
  });
  beforeEach(async () => {
    await hub.close();
    hub = new RealtimeHub(db, source, silent);
    hub.start();
    await reset(db);
    maya = await createUser(db, "maya");
    ari = await createUser(db, "ari");
    const relay = await db.project.create({
      data: { ownerId: maya.id, slug: "relay", key: "RELAY", name: "Relay", members: { create: { userId: maya.id, role: "OWNER" } } },
    });
    relayId = relay.id;
  });

  it("routes project changes to members only, with the project path", async () => {
    const m = await connect(maya);
    const a = await connect(ari);
    emit({ k: "task", p: relayId });
    await sleep(FLUSHED);
    expect(m.changes()).toEqual([{ k: "task", project: { owner: "maya", slug: "relay" } }]);
    expect(a.changes()).toEqual([]);
  });

  it("coalesces a burst into one message per kind and project", async () => {
    const m = await connect(maya);
    for (let i = 0; i < 50; i++) emit({ k: "task", p: relayId });
    emit({ k: "activity", p: relayId });
    emit({ k: "task", p: relayId });
    await sleep(FLUSHED);
    expect(m.frames.filter((f) => f.startsWith("event: change"))).toHaveLength(1);
    expect(m.changes().map((c) => c.k).sort()).toEqual(["activity", "task"]);
  });

  it("starts and stops a stream's project access as membership changes", async () => {
    const a = await connect(ari);
    await db.projectMember.create({ data: { projectId: relayId, userId: ari.id, role: "CONTRIBUTOR" } });
    await hub.handle({ k: "member", p: relayId, u: ari.id, op: "insert" });
    emit({ k: "task", p: relayId });
    await sleep(FLUSHED);
    expect(a.changes().map((c) => c.k)).toEqual(expect.arrayContaining(["projects", "task"]));

    a.frames.length = 0;
    emit({ k: "comment", p: relayId });
    // Removal is processed before the queued comment flushes; nothing about the project leaks after.
    await hub.handle({ k: "member", p: relayId, u: ari.id, op: "delete" });
    emit({ k: "task", p: relayId });
    await sleep(FLUSHED);
    expect(a.changes()).toEqual([{ k: "projects" }]);
  });

  it("sends notification hints to the recipient's streams only", async () => {
    const m1 = await connect(maya);
    const m2 = await connect(maya);
    const a = await connect(ari);
    emit({ k: "notification", u: maya.id });
    await sleep(FLUSHED);
    expect(m1.changes()).toEqual([{ k: "notification" }]);
    expect(m2.changes()).toEqual([{ k: "notification" }]);
    expect(a.changes()).toEqual([]);
  });

  it("follows renames and stops on deletion", async () => {
    const m = await connect(maya);
    await db.project.update({ where: { id: relayId }, data: { slug: "relay-v2" } });
    await hub.handle({ k: "project", p: relayId });
    emit({ k: "task", p: relayId });
    await sleep(FLUSHED);
    expect(m.changes()).toEqual(
      expect.arrayContaining([{ k: "projects" }, { k: "task", project: { owner: "maya", slug: "relay-v2" } }]),
    );

    m.frames.length = 0;
    await db.project.update({ where: { id: relayId }, data: { deletedAt: new Date() } });
    await hub.handle({ k: "project", p: relayId });
    emit({ k: "task", p: relayId });
    await sleep(FLUSHED);
    expect(m.changes()).toEqual([{ k: "projects" }]);
  });

  it("closes the oldest stream past the per-user cap", async () => {
    const streams = [];
    for (let i = 0; i < MAX_STREAMS_PER_USER + 1; i++) streams.push(await connect(maya));
    expect(streams[0]!.state.ended).toBe(true);
    expect(streams.slice(1).every((s) => !s.state.ended)).toBe(true);
    expect(hub.size).toBe(MAX_STREAMS_PER_USER);
  });

  it("drops a stream that stops reading instead of buffering without bound", async () => {
    const m = await connect(maya);
    m.state.buffered = 10 * 1024 * 1024;
    emit({ k: "task", p: relayId });
    await sleep(FLUSHED);
    expect(m.state.ended).toBe(true);
    expect(hub.size).toBe(0);
  });

  it("tells every client to resync after the listener reconnects", async () => {
    const m = await connect(maya);
    const a = await connect(ari);
    ready(false);
    await sleep(FLUSHED);
    expect(m.changes()).toEqual([]);
    ready(true);
    await sleep(FLUSHED);
    expect(m.changes()).toEqual([{ k: "resync" }]);
    expect(a.changes()).toEqual([{ k: "resync" }]);
  });
});

describe("realtime over HTTP", () => {
  let ctx: TestContext;
  let base: string;

  beforeAll(async () => {
    ctx = await setup({ realtime: true });
    base = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await reset(ctx.db);
  });

  function stream(user?: TestUser) {
    const ctrl = new AbortController();
    const events: { event: string; data: unknown }[] = [];
    const opened = fetch(`${base}/realtime`, { headers: user ? { cookie: user.cookie } : {}, signal: ctrl.signal }).then(async (res) => {
      if (res.ok && res.body) {
        void (async () => {
          const decoder = new TextDecoder();
          let buf = "";
          try {
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
              buf += decoder.decode(chunk, { stream: true });
              let i: number;
              while ((i = buf.indexOf("\n\n")) >= 0) {
                const frame = buf.slice(0, i);
                buf = buf.slice(i + 2);
                const event = /^event: (.+)$/m.exec(frame)?.[1];
                const data = /^data: (.+)$/m.exec(frame)?.[1];
                if (event) events.push({ event, data: data ? JSON.parse(data) : null });
              }
            }
          } catch {
            // aborted
          }
        })();
      }
      return res;
    });
    const changes = () => events.filter((e) => e.event === "change").flatMap((e) => e.data as ClientChange[]);
    return { opened, events, changes, close: () => ctrl.abort() };
  }

  it("rejects anonymous streams", async () => {
    const s = stream();
    expect((await s.opened).status).toBe(401);
  });

  it("delivers database changes from triggers to members, end to end", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const m = stream(maya);
    const a = stream(ari);
    const res = await m.opened;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    await waitFor(() => m.events.some((e) => e.event === "ready") && a.events.some((e) => e.event === "ready"));

    // Creating a project inserts a membership row: the creator's stream starts following it.
    const created = await client(ctx.app, maya).post("/projects", { name: "Relay", visibility: "PUBLIC" });
    expect(created.status).toBe(201);
    await waitFor(() => m.changes().some((c) => c.k === "projects"));

    const task = await client(ctx.app, maya).post("/projects/maya/relay/tasks", { title: "Live" });
    expect(task.status).toBe(201);
    await waitFor(() => m.changes().some((c) => c.k === "task" && "project" in c && c.project.slug === "relay"));

    // A notification for ari reaches ari, and ari never saw the private task traffic.
    await ctx.db.notification.create({ data: { recipientId: ari.id, type: "test", data: {} } });
    await waitFor(() => a.changes().some((c) => c.k === "notification"));
    expect(a.changes().filter((c) => c.k !== "notification")).toEqual([]);

    m.close();
    a.close();
    await waitFor(() => ctx.app.deps.realtime!.size === 0 || undefined);
  });

  it("ends the stream when the session is signed out", async () => {
    const maya = await createUser(ctx.db, "maya");
    const m = stream(maya);
    await m.opened;
    await waitFor(() => m.events.some((e) => e.event === "ready"));
    expect(ctx.app.deps.realtime!.size).toBe(1);
    await client(ctx.app, maya).post("/auth/logout");
    // Session checks run on the heartbeat; trigger one directly instead of waiting minutes.
    const hub = ctx.app.deps.realtime as unknown as { beats: number; beat(): Promise<void> };
    hub.beats = 7;
    await hub.beat();
    await waitFor(() => ctx.app.deps.realtime!.size === 0 || undefined);
    m.close();
  });
});
