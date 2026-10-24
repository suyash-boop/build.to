import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { client, createUser, reset, setup, sign, type TestContext, ORIGIN } from "./helpers.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await reset(ctx.db);
  ctx.jobs.length = 0;
});

async function newProject(user: Awaited<ReturnType<typeof createUser>>, body: Record<string, unknown> = {}) {
  const res = await client(ctx.app, user).post("/projects", { name: "Relay API", visibility: "PUBLIC", ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { owner: string; slug: string; key: string };
}

describe("projects", () => {
  it("creates a project with derived slug and key, unique per owner", async () => {
    const maya = await createUser(ctx.db, "maya");
    const a = await newProject(maya);
    expect(a).toEqual({ owner: "maya", slug: "relay-api", key: "RELAY" });
    const b = await newProject(maya);
    expect(b.slug).toBe("relay-api-2");
    expect(b.key).toBe("RELAY2");

    const detail = await client(ctx.app, maya).get("/projects/maya/relay-api");
    expect(detail.status).toBe(200);
    expect(detail.body.viewer.role).toBe("OWNER");
    expect(detail.body.viewer.permissions).toContain("project.delete");
    expect(detail.body.memberCount).toBe(1);
  });

  it("hides private projects from outsiders with a 404, not a 403", async () => {
    const maya = await createUser(ctx.db, "maya");
    const eve = await createUser(ctx.db, "eve");
    await newProject(maya, { visibility: "PRIVATE" });
    expect((await client(ctx.app, eve).get("/projects/maya/relay-api")).status).toBe(404);
    expect((await client(ctx.app).get("/projects/maya/relay-api")).status).toBe(404);
  });

  it("lets the public read public projects but not their task board", async () => {
    const maya = await createUser(ctx.db, "maya");
    await newProject(maya);
    const anon = client(ctx.app);
    const detail = await anon.get("/projects/maya/relay-api");
    expect(detail.status).toBe(200);
    expect(detail.body.viewer.role).toBeNull();
    expect(detail.body.stats.openTasks).toBe(0);
    expect((await anon.get("/projects/maya/relay-api/tasks")).status).toBe(403);
  });

  it("requires the owner to change visibility", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "MAINTAINER");
    const res = await client(ctx.app, ari).patch("/projects/maya/relay-api", { visibility: "PRIVATE" });
    expect(res.status).toBe(403);
    expect((await client(ctx.app, ari).patch("/projects/maya/relay-api", { tagline: "Edge rate limiting" })).status).toBe(200);
  });

  it("rejects state-changing requests from other origins", async () => {
    const maya = await createUser(ctx.db, "maya");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/projects",
      headers: { cookie: maya.cookie, origin: "https://evil.example", "content-type": "application/json" },
      payload: JSON.stringify({ name: "x" }),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("tasks", () => {
  it("numbers tasks per project, tracks timestamps, and records activity", async () => {
    const maya = await createUser(ctx.db, "maya");
    await newProject(maya);
    const api = client(ctx.app, maya);
    const t1 = await api.post("/projects/maya/relay-api/tasks", { title: "Token bucket" });
    const t2 = await api.post("/projects/maya/relay-api/tasks", { title: "Sliding window", priority: "HIGH" });
    expect(t1.body.identifier).toBe("RELAY-1");
    expect(t2.body.identifier).toBe("RELAY-2");

    const started = await api.patch("/projects/maya/relay-api/tasks/1", { status: "IN_PROGRESS" });
    expect(started.status).toBe(200);
    const done = await api.patch("/projects/maya/relay-api/tasks/1", { status: "DONE" });
    expect(done.body.completedAt).not.toBeNull();

    const detail = await api.get("/projects/maya/relay-api/tasks/1");
    expect(detail.body.startedAt).not.toBeNull();
    expect(detail.body.history.map((h: { type: string }) => h.type)).toEqual(["task.created", "task.status_changed", "task.completed"]);
  });

  it("reorders within a column using neighbour ids", async () => {
    const maya = await createUser(ctx.db, "maya");
    await newProject(maya);
    const api = client(ctx.app, maya);
    const ids: string[] = [];
    for (const title of ["a", "b", "c"]) ids.push((await api.post("/projects/maya/relay-api/tasks", { title })).body.id);
    // Move "c" between "a" and "b".
    await api.patch("/projects/maya/relay-api/tasks/3", { move: { beforeId: ids[0], afterId: ids[1] } });
    const list = await api.get("/projects/maya/relay-api/tasks");
    expect(list.body.items.map((t: { title: string }) => t.title)).toEqual(["a", "c", "b"]);
  });

  it("only assigns members with contributor access and notifies them", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const vic = await createUser(ctx.db, "vic");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "CONTRIBUTOR");
    await addMember(p, maya, vic, "VIEWER");
    const api = client(ctx.app, maya);
    expect((await api.post("/projects/maya/relay-api/tasks", { title: "x", assigneeId: vic.id })).status).toBe(400);
    expect((await api.post("/projects/maya/relay-api/tasks", { title: "x", assigneeId: ari.id })).status).toBe(201);
    const notes = await client(ctx.app, ari).get("/notifications");
    expect(notes.body.items.map((n: { type: string }) => n.type)).toContain("task.assigned");
    // Viewers cannot create tasks.
    expect((await client(ctx.app, vic).post("/projects/maya/relay-api/tasks", { title: "y" })).status).toBe(403);
  });

  it("notifies mentioned members on comments", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "CONTRIBUTOR");
    const api = client(ctx.app, maya);
    await api.post("/projects/maya/relay-api/tasks", { title: "x" });
    const c = await api.post("/projects/maya/relay-api/tasks/1/comments", { body: "@ari can you review?" });
    expect(c.status).toBe(201);
    const notes = await client(ctx.app, ari).get("/notifications");
    expect(notes.body.items[0].type).toBe("task.commented");
  });
});

describe("membership", () => {
  it("runs the invitation flow and enforces role ceilings", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const sam = await createUser(ctx.db, "sam");
    await newProject(maya, { visibility: "PRIVATE" });

    const inv = await client(ctx.app, maya).post("/projects/maya/relay-api/invitations", { username: "ari", role: "MAINTAINER" });
    expect(inv.status).toBe(201);
    expect((await client(ctx.app, maya).post("/projects/maya/relay-api/invitations", { username: "ari" })).status).toBe(409);

    const mine = await client(ctx.app, ari).get("/invitations");
    expect(mine.body.items).toHaveLength(1);
    const accept = await client(ctx.app, ari).post(`/invitations/${inv.body.id}/respond`, { accept: true });
    expect(accept.status).toBe(200);
    expect((await client(ctx.app, ari).get("/projects/maya/relay-api")).body.viewer.role).toBe("MAINTAINER");

    // A maintainer cannot create peers.
    const peer = await client(ctx.app, ari).post("/projects/maya/relay-api/invitations", { username: "sam", role: "MAINTAINER" });
    expect(peer.status).toBe(403);
    const ok = await client(ctx.app, ari).post("/projects/maya/relay-api/invitations", { username: "sam", role: "CONTRIBUTOR" });
    expect(ok.status).toBe(201);
    // Maintainer cannot remove the owner; owner cannot leave without transfer.
    expect((await client(ctx.app, ari).del(`/projects/maya/relay-api/members/${maya.id}`)).status).toBe(403);
    expect((await client(ctx.app, maya).del(`/projects/maya/relay-api/members/${maya.id}`)).status).toBe(403);
    void sam;
  });

  it("accepts join requests only on open public projects", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    await newProject(maya);
    const ask = () => client(ctx.app, ari).post("/projects/maya/relay-api/requests", { message: "I build rate limiters at work." });
    expect((await ask()).status).toBe(403);

    await client(ctx.app, maya).patch("/projects/maya/relay-api", { openToContributors: true });
    const req = await ask();
    expect(req.status).toBe(201);
    expect((await ask()).status).toBe(409);

    const home = await client(ctx.app, maya).get("/home");
    expect(home.body.attention.joinRequests).toHaveLength(1);

    const decide = await client(ctx.app, maya).post(`/projects/maya/relay-api/requests/${req.body.id}/decide`, { decision: "APPROVE" });
    expect(decide.status).toBe(200);
    expect((await client(ctx.app, ari).get("/projects/maya/relay-api")).body.viewer.role).toBe("CONTRIBUTOR");
  });

  it("transfers ownership to a maintainer", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "MAINTAINER");
    const res = await client(ctx.app, maya).post("/projects/maya/relay-api/transfer", { userId: ari.id });
    expect(res.status).toBe(200);
    expect(res.body.owner).toBe("ari");
    expect((await client(ctx.app, ari).get("/projects/ari/relay-api")).body.viewer.role).toBe("OWNER");
  });
});

describe("shipping and profile", () => {
  it("ships a project, notifies the team, and shows it on profiles", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "CONTRIBUTOR");

    // Shipping is a maintainer action; contributors cannot.
    expect((await client(ctx.app, ari).post("/projects/maya/relay-api/ship", { title: "v1" })).status).toBe(403);
    // Moving straight to SHIPPED without a release is refused so launches are recorded.
    expect((await client(ctx.app, maya).post("/projects/maya/relay-api/stage", { stage: "SHIPPED" })).status).toBe(400);

    const ship = await client(ctx.app, maya).post("/projects/maya/relay-api/ship", { title: "Public beta", version: "v1.0.0" });
    expect(ship.status).toBe(201);
    expect(ship.body.shipped).toBe(true);

    const detail = await client(ctx.app).get("/projects/maya/relay-api");
    expect(detail.body.stage).toBe("SHIPPED");
    expect(detail.body.shippedAt).not.toBeNull();

    const notes = await client(ctx.app, ari).get("/notifications");
    expect(notes.body.items.map((n: { type: string }) => n.type)).toContain("project.shipped");

    const profile = await client(ctx.app).get("/users/ari");
    expect(profile.body.summary.shipped).toBe(1);
    expect(profile.body.history.some((h: { kind: string }) => h.kind === "shipped")).toBe(true);
  });

  it("counts private work anonymously and keeps unlisted projects off public profiles", async () => {
    const maya = await createUser(ctx.db, "maya");
    await newProject(maya, { name: "Client portal", visibility: "PRIVATE" });
    await newProject(maya, { name: "Side quest", visibility: "UNLISTED" });
    await newProject(maya, { name: "Open thing", visibility: "PUBLIC" });

    const anon = await client(ctx.app).get("/users/maya");
    expect(anon.body.projects.map((x: { name: string }) => x.name)).toEqual(["Open thing"]);
    expect(anon.body.summary.privateProjects).toBe(2);
    expect(JSON.stringify(anon.body)).not.toContain("Client portal");

    const self = await client(ctx.app, maya).get("/users/maya");
    expect(self.body.projects).toHaveLength(3);
    expect(self.body.isSelf).toBe(true);

    // Unlisted is reachable by link.
    expect((await client(ctx.app).get("/projects/maya/side-quest")).status).toBe(200);
    // But never in discovery.
    const disc = await client(ctx.app).get("/discover/projects");
    expect(disc.body.items.map((x: { name: string }) => x.name)).toEqual(["Open thing"]);
  });

  it("lets members hide a project from their profile entirely", async () => {
    const maya = await createUser(ctx.db, "maya");
    await newProject(maya);
    await client(ctx.app, maya).patch("/projects/maya/relay-api/membership", { showOnProfile: false });
    const anon = await client(ctx.app).get("/users/maya");
    expect(anon.body.projects).toHaveLength(0);
    expect(anon.body.summary.privateProjects).toBe(0);
  });
});

describe("search and pagination", () => {
  it("finds tasks by identifier for members only", async () => {
    const maya = await createUser(ctx.db, "maya");
    const eve = await createUser(ctx.db, "eve");
    await newProject(maya);
    await client(ctx.app, maya).post("/projects/maya/relay-api/tasks", { title: "Token bucket" });
    const hit = await client(ctx.app, maya).get("/search?q=RELAY-1");
    expect(hit.body.tasks[0].identifier).toBe("RELAY-1");
    const miss = await client(ctx.app, eve).get("/search?q=RELAY-1");
    expect(miss.body.tasks).toHaveLength(0);
  });

  it("paginates discovery with stable cursors and keeps filters on later pages", async () => {
    const maya = await createUser(ctx.db, "maya");
    for (let i = 0; i < 5; i++) await newProject(maya, { name: `Alpha ${i}` });
    await newProject(maya, { name: "Beta" });
    const p1 = await client(ctx.app).get("/discover/projects?limit=2&q=alpha");
    expect(p1.body.items).toHaveLength(2);
    const p2 = await client(ctx.app).get(`/discover/projects?limit=2&q=alpha&cursor=${p1.body.nextCursor}`);
    const p3 = await client(ctx.app).get(`/discover/projects?limit=2&q=alpha&cursor=${p2.body.nextCursor}`);
    const names = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((x: { name: string }) => x.name);
    expect(new Set(names).size).toBe(5);
    expect(names).not.toContain("Beta");
    expect(p3.body.nextCursor).toBeNull();
  });
});

describe("people discovery and matching", () => {
  async function techs(owner: Awaited<ReturnType<typeof createUser>>, slug: string, add: string[]) {
    const res = await client(ctx.app, owner).patch(`/projects/${owner.username}/${slug}/technologies`, { add });
    expect(res.status).toBe(200);
  }

  it("lists people from public work only and never reveals private stacks", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    await newProject(maya, { name: "Open Go", visibility: "PUBLIC" });
    await techs(maya, "open-go", ["go"]);
    await newProject(ari, { name: "Secret Rust", visibility: "PRIVATE" });
    await techs(ari, "secret-rust", ["rust"]);

    const all = await client(ctx.app).get("/discover/people");
    expect(all.body.items.map((p: { username: string }) => p.username)).toEqual(["maya"]);
    expect(all.body.items[0].technologies.map((t: { slug: string }) => t.slug)).toEqual(["go"]);

    const rust = await client(ctx.app).get("/discover/people?tech=rust");
    expect(rust.body.items).toHaveLength(0);
  });

  it("suggests open projects that fit the viewer's stack, skipping ones they are in", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    await newProject(ari, { name: "Ari Go", visibility: "PUBLIC" });
    await techs(ari, "ari-go", ["go", "postgresql"]);
    await newProject(maya, { name: "Go service", visibility: "PUBLIC" });
    await techs(maya, "go-service", ["go", "postgresql"]);
    await client(ctx.app, maya).patch("/projects/maya/go-service", { openToContributors: true });
    await newProject(maya, { name: "Python thing", visibility: "PUBLIC" });
    await techs(maya, "python-thing", ["python"]);
    await client(ctx.app, maya).patch("/projects/maya/python-thing", { openToContributors: true });

    const forAri = await client(ctx.app, ari).get("/discover/suggestions");
    expect(forAri.body.items.map((p: { slug: string }) => p.slug)).toEqual(["go-service"]);
    expect(forAri.body.items[0].reason.technologies.map((t: { slug: string }) => t.slug).sort()).toEqual(["go", "postgresql"]);

    // Maya owns both open projects, so nothing is suggested to her.
    const forMaya = await client(ctx.app, maya).get("/discover/suggestions");
    expect(forMaya.body.items).toHaveLength(0);
  });

  it("ranks people with their own GitHub evidence above people who only shared a team", async () => {
    const owner = await createUser(ctx.db, "owner");
    const evidenced = await createUser(ctx.db, "shipper");
    const bystander = await createUser(ctx.db, "bystander");
    await newProject(owner, { name: "Needs Go", visibility: "PUBLIC" });
    await techs(owner, "needs-go", ["go"]);

    for (const u of [evidenced, bystander]) {
      await newProject(u, { name: `${u.username} go`, visibility: "PUBLIC" });
      await techs(u, `${u.username}-go`, ["go"]);
    }
    const p = await ctx.db.project.findFirstOrThrow({ where: { slug: "shipper-go" } });
    const repo = await ctx.db.repository.create({
      data: { githubId: 1n, ownerLogin: "s", name: "r", fullName: "s/r", htmlUrl: "https://github.com/s/r", isPrivate: false },
    });
    await ctx.db.contribution.create({
      data: { projectId: p.id, repositoryId: repo.id, userId: evidenced.id, githubLogin: "shipper", commits: 40, prsMerged: 6 },
    });

    const res = await client(ctx.app, owner).get("/projects/owner/needs-go/suggested-people");
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: { username: string }) => x.username)).toEqual(["shipper", "bystander"]);
    expect(res.body.items[0].reason.evidenced).toBe(1);

    // Contributors cannot see suggestions; it is an invite tool for maintainers.
    const ari = await createUser(ctx.db, "ari");
    const inv = await client(ctx.app, owner).post("/projects/owner/needs-go/invitations", { username: "ari", role: "CONTRIBUTOR" });
    await client(ctx.app, ari).post(`/invitations/${inv.body.id}/respond`, { accept: true });
    expect((await client(ctx.app, ari).get("/projects/owner/needs-go/suggested-people")).status).toBe(403);
  });
});

describe("insights", () => {
  it("computes flow metrics and a milestone forecast from task history, for members only", async () => {
    const maya = await createUser(ctx.db, "maya");
    const p = await newProject(maya);
    const project = await ctx.db.project.findFirstOrThrow({ where: { slug: p.slug } });
    const ms = await ctx.db.milestone.create({ data: { projectId: project.id, title: "Beta", status: "ACTIVE", position: 1, dueOn: new Date(Date.now() + 60 * 86_400_000) } });
    const day = 86_400_000;
    const now = Date.now();
    // Six weeks of steady completions: 2 per week, each took exactly 2 days of work.
    let n = 0;
    for (let w = 0; w < 6; w++) {
      for (let k = 0; k < 2; k++) {
        const completedAt = new Date(now - (w * 7 + 1 + k) * day);
        await ctx.db.task.create({
          data: { projectId: project.id, number: ++n, title: `t${n}`, status: "DONE", position: n, creatorId: maya.id, createdAt: new Date(completedAt.getTime() - 3 * day), startedAt: new Date(completedAt.getTime() - 2 * day), completedAt },
        });
      }
    }
    for (let k = 0; k < 6; k++) {
      await ctx.db.task.create({ data: { projectId: project.id, number: ++n, title: `open${k}`, status: k === 0 ? "IN_PROGRESS" : "TODO", position: n, creatorId: maya.id, milestoneId: ms.id, startedAt: k === 0 ? new Date(now - 30 * day) : null } });
    }

    const res = await client(ctx.app, maya).get("/projects/maya/relay-api/insights?window=90");
    expect(res.status).toBe(200);
    expect(res.headers?.["x-cache"] ?? res.raw.headers["x-cache"]).toBe("miss");
    const d = res.body;
    expect(d.tasks.completed).toBe(12);
    expect(d.tasks.cycleTime.p50).toBe(48);
    expect(d.tasks.leadTime.p50).toBe(72);
    expect(d.tasks.wip).toBe(1);
    // 30 days in progress against an 85th percentile of 2 days: flagged as aging.
    expect(d.tasks.aging[0]).toMatchObject({ identifier: "RELAY-13", stale: true });
    const f = d.forecasts[0];
    expect(f.remaining).toBe(6);
    // About 2 per week: roughly three weeks out, comfortably before a due date 60 days away.
    expect(f.onTimeProbability).toBeGreaterThan(0.9);
    expect(f.p50 <= f.p85 && f.p85 <= f.p95).toBe(true);

    const again = await client(ctx.app, maya).get("/projects/maya/relay-api/insights?window=90");
    expect(again.raw.headers["x-cache"]).toBe("hit");

    // Public project, but insights are workspace data.
    expect((await client(ctx.app).get("/projects/maya/relay-api/insights")).status).toBe(403);
  });
});

describe("signals", () => {
  it("lists, snoozes and configures signals with the right permissions", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const vic = await createUser(ctx.db, "vic");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "CONTRIBUTOR");
    await addMember(p, maya, vic, "VIEWER");
    const project = await ctx.db.project.findFirstOrThrow({ where: { slug: p.slug } });
    const base = `/projects/${p.owner}/${p.slug}`;
    const mk = (dedupeKey: string, severity: "INFO" | "WARNING" | "CRITICAL", firstSeenAt = new Date()) =>
      ctx.db.signal.create({ data: { projectId: project.id, type: "task.stalled", dedupeKey, severity, title: dedupeKey, data: {}, firstSeenAt, lastSeenAt: new Date() } });
    const warn = await mk("a", "WARNING");
    await mk("b", "CRITICAL");
    await mk("c", "INFO");
    await ctx.db.signal.create({ data: { projectId: project.id, type: "task.stalled", dedupeKey: "old", severity: "CRITICAL", title: "old", data: {}, lastSeenAt: new Date(), resolvedAt: new Date() } });

    const list = await client(ctx.app, vic).get(`${base}/signals`);
    expect(list.status).toBe(200);
    // Most severe first; resolved signals are history, not attention.
    expect(list.body.open.map((s: { title: string }) => s.title)).toEqual(["b", "a", "c"]);
    expect((await client(ctx.app).get(`${base}/signals`)).status).toBe(403);

    // Viewers can look but not snooze.
    expect((await client(ctx.app, vic).post(`${base}/signals/${warn.id}/snooze`, { days: 3 })).status).toBe(403);
    expect((await client(ctx.app, ari).post(`${base}/signals/${warn.id}/snooze`, { days: 2 })).status).toBe(400);
    const snooze = await client(ctx.app, ari).post(`${base}/signals/${warn.id}/snooze`, { days: 3 });
    expect(snooze.status).toBe(200);
    const after = await client(ctx.app, ari).get(`${base}/signals`);
    expect(after.body.open.map((s: { title: string }) => s.title)).toEqual(["b", "c"]);
    expect(after.body.snoozed.map((s: { title: string }) => s.title)).toEqual(["a"]);
    // Home shows only unsnoozed warnings and criticals.
    expect((await client(ctx.app, maya).get("/home")).body.signals.map((s: { title: string }) => s.title)).toEqual(["b"]);

    // Unsnooze; a signal id from another project is not found.
    expect((await client(ctx.app, ari).post(`${base}/signals/${warn.id}/snooze`, { days: 0 })).body.snoozedUntil).toBeNull();
    const other = await newProject(maya, { name: "Other" });
    expect((await client(ctx.app, maya).post(`/projects/${other.owner}/${other.slug}/signals/${warn.id}/snooze`, { days: 1 })).status).toBe(404);

    // Settings: defaults, maintainers only, validated, clamped, and a rescan is queued.
    expect((await client(ctx.app, ari).get(`${base}/signal-settings`)).body).toMatchObject({ stalledDays: 5, reviewHours: 24, wipLimit: 3, disabled: [] });
    expect((await client(ctx.app, ari).patch(`${base}/signal-settings`, { stalledDays: 3 })).status).toBe(403);
    expect((await client(ctx.app, maya).patch(`${base}/signal-settings`, { disabled: ["nope"] })).status).toBe(400);
    const jobsBefore = ctx.jobs.length;
    const saved = await client(ctx.app, maya).patch(`${base}/signal-settings`, { stalledDays: 3, disabled: ["pr.unlinked"] });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ stalledDays: 3, wipLimit: 3, disabled: ["pr.unlinked"] });
    expect(ctx.jobs.slice(jobsBefore)).toEqual([expect.objectContaining({ name: "signals.scan", data: { projectId: project.id } })]);
    expect((await client(ctx.app, maya).patch(`${base}/signal-settings`, { wipLimit: 5 })).body).toMatchObject({ stalledDays: 3, wipLimit: 5 });
  });

  it("queues a debounced rescan when task state changes", async () => {
    const maya = await createUser(ctx.db, "maya");
    const p = await newProject(maya);
    const created = await client(ctx.app, maya).post(`/projects/${p.owner}/${p.slug}/tasks`, { title: "Wire it" });
    expect(created.status).toBe(201);
    expect(ctx.jobs.some((j) => j.name === "signals.scan")).toBe(true);
  });
});

describe("outbound webhooks", () => {
  // An IP literal needs no DNS, so tests stay offline.
  const PUBLIC_URL = "https://93.184.216.34/hooks/abc";

  it("lets maintainers manage endpoints, with safe URLs and one-time secrets", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "CONTRIBUTOR");
    const base = `/projects/${p.owner}/${p.slug}/webhooks`;
    const m = client(ctx.app, maya);

    expect((await client(ctx.app, ari).get(base)).status).toBe(403);
    expect((await client(ctx.app, ari).post(base, { url: PUBLIC_URL })).status).toBe(403);

    for (const url of ["http://93.184.216.34/x", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest", "https://u:p@93.184.216.34/"]) {
      const r = await m.post(base, { url });
      expect(r.status, url).toBe(422);
    }
    expect((await m.post(base, { url: PUBLIC_URL, events: ["nope"] })).status).toBe(400);

    const created = await m.post(base, { url: PUBLIC_URL, format: "SLACK", events: ["task", "task", "signal"], description: "Team channel" });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_[\w-]{43}$/);
    expect(created.body.endpoint).toMatchObject({ format: "SLACK", events: ["task", "signal"], active: true, createdBy: { username: "maya" } });
    const id = created.body.endpoint.id;

    // The secret is never readable again, only rotatable.
    const list = await m.get(base);
    expect(JSON.stringify(list.body)).not.toMatch(/whsec_|secretEncrypted/);
    const rotated = await m.post(`${base}/${id}/rotate-secret`);
    expect(rotated.body.secret).toMatch(/^whsec_/);
    expect(rotated.body.secret).not.toBe(created.body.secret);
    const stored = await ctx.db.webhookEndpoint.findUniqueOrThrow({ where: { id } });
    expect(ctx.app.deps.encrypter.decrypt(stored.secretEncrypted)).toBe(rotated.body.secret);

    // Audit entries mask the token-bearing path.
    const logged = await ctx.db.auditLog.findFirstOrThrow({ where: { action: "webhook.created" } });
    expect(JSON.stringify(logged.metadata)).not.toContain("/hooks/abc");

    // Update: URL is vetted again; re-enabling clears the failure state.
    expect((await m.patch(`${base}/${id}`, { url: "https://10.0.0.1/x" })).status).toBe(422);
    await ctx.db.webhookEndpoint.update({ where: { id }, data: { active: false, consecutiveFailures: 15, disabledReason: "broken" } });
    const enabled = await m.patch(`${base}/${id}`, { active: true, events: [] });
    expect(enabled.body).toMatchObject({ active: true, consecutiveFailures: 0, disabledReason: null, events: [] });

    // Other projects cannot reach this endpoint by id.
    const other = await newProject(maya, { name: "Other" });
    expect((await m.patch(`/projects/${other.owner}/${other.slug}/webhooks/${id}`, { active: false })).status).toBe(404);

    expect((await m.del(`${base}/${id}`)).status).toBe(200);
    expect(await ctx.db.webhookEndpoint.count()).toBe(0);
  });

  it("caps endpoints per project", async () => {
    const maya = await createUser(ctx.db, "maya");
    const p = await newProject(maya);
    const base = `/projects/${p.owner}/${p.slug}/webhooks`;
    for (let i = 0; i < 10; i++) expect((await client(ctx.app, maya).post(base, { url: `${PUBLIC_URL}/${i}` })).status).toBe(201);
    expect((await client(ctx.app, maya).post(base, { url: PUBLIC_URL })).status).toBe(409);
  });

  it("sends test events, lists deliveries, shows the exact request, and redelivers", async () => {
    const maya = await createUser(ctx.db, "maya");
    const p = await newProject(maya);
    const base = `/projects/${p.owner}/${p.slug}/webhooks`;
    const m = client(ctx.app, maya);
    const id = (await m.post(base, { url: PUBLIC_URL, format: "DISCORD" })).body.endpoint.id;

    const before = ctx.jobs.length;
    const test = await m.post(`${base}/${id}/test`);
    expect(test.status).toBe(202);
    expect(test.body).toMatchObject({ event: "ping", status: "PENDING", attempts: 0 });
    expect(ctx.jobs.slice(before)).toEqual([{ name: "outbound.deliver", data: { deliveryId: test.body.id } }]);

    const list = await m.get(`${base}/${id}/deliveries`);
    expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([test.body.id]);
    expect((await m.get(`${base}/${id}/deliveries?status=FAILED`)).body.items).toEqual([]);

    const detail = await m.get(`${base}/${id}/deliveries/${test.body.id}`);
    const sent = JSON.parse(detail.body.requestBody);
    expect(sent).toMatchObject({ username: "bld.t", allowed_mentions: { parse: [] } });

    const again = await m.post(`${base}/${id}/deliveries/${test.body.id}/redeliver`);
    expect(again.status).toBe(202);
    const rows = await ctx.db.outboundDelivery.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    // Same envelope id, so receivers can dedupe.
    expect((rows[1]!.payload as { id: string }).id).toBe((rows[0]!.payload as { id: string }).id);

    await m.patch(`${base}/${id}`, { active: false });
    expect((await m.post(`${base}/${id}/deliveries/${test.body.id}/redeliver`)).status).toBe(409);
    // Tests still work while disabled, without re-enabling.
    expect((await m.post(`${base}/${id}/test`)).status).toBe(202);
    expect((await ctx.db.webhookEndpoint.findUniqueOrThrow({ where: { id } })).active).toBe(false);
  });
});

describe("work records", () => {
  const DAY = 86_400_000;

  async function seedWork() {
    const maya = await createUser(ctx.db, "maya");
    await ctx.db.githubAccount.create({ data: { userId: maya.id, githubUserId: 501n, login: "maya-gh", accessToken: "x" } });
    const p = await newProject(maya);
    const project = await ctx.db.project.findFirstOrThrow({ where: { slug: p.slug } });
    const repo = await ctx.db.repository.create({
      data: { githubId: 9001n, ownerLogin: "maya-gh", name: "relay", fullName: "maya-gh/relay", htmlUrl: "https://github.com/maya-gh/relay", defaultBranch: "main", isPrivate: false },
    });
    await ctx.db.projectRepository.create({ data: { projectId: project.id, repositoryId: repo.id, isPrimary: true } });
    let gid = 100n;
    const pr = (number: number, authorGithubId: bigint, state: "MERGED" | "OPEN", mergedDaysAgo: number | null, additions = 10) =>
      ctx.db.pullRequest.create({
        data: {
          githubId: gid++,
          repositoryId: repo.id,
          number,
          title: `PR ${number}`,
          htmlUrl: `https://github.com/maya-gh/relay/pull/${number}`,
          state,
          authorLogin: authorGithubId === 501n ? "maya-gh" : "someone",
          authorGithubId,
          headRef: "x",
          additions,
          deletions: 2,
          openedAt: new Date(Date.now() - 60 * DAY),
          mergedAt: mergedDaysAgo == null ? null : new Date(Date.now() - mergedDaysAgo * DAY),
        },
      });
    await pr(1, 501n, "MERGED", 3, 100); // counts
    await pr(2, 501n, "MERGED", 10, 50); // counts
    await pr(3, 777n, "MERGED", 3); // someone else
    await pr(4, 501n, "OPEN", null); // not merged
    await pr(5, 501n, "MERGED", 400); // outside the period
    await ctx.db.task.create({ data: { projectId: project.id, number: 1, title: "Token bucket", status: "DONE", position: 1, creatorId: maya.id, assigneeId: maya.id, completedAt: new Date(Date.now() - 2 * DAY) } });
    await ctx.db.task.create({ data: { projectId: project.id, number: 2, title: "Not done", status: "TODO", position: 2, creatorId: maya.id, assigneeId: maya.id } });
    return { maya, p, project };
  }

  const from = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);

  it("issues a signed record from verified evidence that anyone can check with the public key", async () => {
    const { maya, p } = await seedWork();
    const res = await client(ctx.app, maya).post("/me/work-records", { owner: p.owner, slug: p.slug, from });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { record, signature } = res.body.signed;
    expect(record).toMatchObject({
      v: 1,
      subject: { username: "maya", github: "maya-gh" },
      project: { name: "Relay API", visibility: "PUBLIC" },
      role: "OWNER",
      period: { from },
      summary: { tasksCompleted: 1, pullRequestsMerged: 2, additions: 150, deletions: 4, releases: 0 },
    });
    expect(record.evidence.map((e: { number: number }) => e.number)).toEqual([1, 2]);
    expect(record.tasks).toEqual([expect.objectContaining({ identifier: "RELAY-1", title: "Token bucket" })]);

    // Independent check: only the published JWKS and Node's crypto, no bld.t code.
    const jwks = (await client(ctx.app).get("/keys")).body;
    const jwk = jwks.keys.find((k: { kid: string }) => k.kid === signature.kid);
    const { createPublicKey, verify } = await import("node:crypto");
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const canonical = (v: unknown): string =>
      Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
    expect(verify(null, Buffer.from(canonical(record)), key, Buffer.from(signature.value, "base64url"))).toBe(true);
    record.summary.pullRequestsMerged = 9;
    expect(verify(null, Buffer.from(canonical(record)), key, Buffer.from(signature.value, "base64url"))).toBe(false);
  });

  it("serves a public view and a verifier that catch tampering and revocation", async () => {
    const { maya, p } = await seedWork();
    const issued = (await client(ctx.app, maya).post("/me/work-records", { owner: p.owner, slug: p.slug, from })).body;
    const id = issued.signed.record.id;

    const view = await client(ctx.app).get(`/work-records/${id}`);
    expect(view.body).toMatchObject({ status: "valid", keyStatus: "current", revokedAt: null });
    expect((await client(ctx.app).post("/work-records/verify", issued.signed)).body).toMatchObject({ status: "valid", reason: null });

    const forged = structuredClone(issued.signed);
    forged.record.role = "OWNER";
    forged.record.summary.reviews = 40;
    expect((await client(ctx.app).post("/work-records/verify", forged)).body).toMatchObject({ status: "invalid", reason: "bad_signature" });
    expect((await client(ctx.app).post("/work-records/verify", { hello: 1 })).body).toMatchObject({ status: "invalid", reason: "malformed" });

    // A row edited in the database is reported as invalid, never shown as genuine.
    const row = await ctx.db.workRecord.findUniqueOrThrow({ where: { id } });
    await ctx.db.workRecord.update({ where: { id }, data: { canonical: row.canonical.replace('"pullRequestsMerged":2', '"pullRequestsMerged":20') } });
    expect((await client(ctx.app).get(`/work-records/${id}`)).body.status).toBe("invalid");
    await ctx.db.workRecord.update({ where: { id }, data: { canonical: row.canonical } });

    // Only the holder can revoke; after that, both paths say so.
    const ari = await createUser(ctx.db, "ari");
    expect((await client(ctx.app, ari).post(`/me/work-records/${id}/revoke`, {})).status).toBe(404);
    expect((await client(ctx.app, maya).post(`/me/work-records/${id}/revoke`, { reason: "Wrong period" })).status).toBe(200);
    expect((await client(ctx.app).get(`/work-records/${id}`)).body).toMatchObject({ status: "revoked", revokedReason: "Wrong period" });
    expect((await client(ctx.app).post("/work-records/verify", issued.signed)).body.status).toBe("revoked");
    expect((await client(ctx.app, maya).post(`/me/work-records/${id}/revoke`, {})).status).toBe(404);

    const list = await client(ctx.app, maya).get("/me/work-records");
    expect(list.body.items).toEqual([expect.objectContaining({ id, revokedAt: expect.any(String), project: expect.objectContaining({ owner: "maya", slug: p.slug }) })]);
    const exported = await client(ctx.app, maya).get("/me/export");
    expect(exported.body.workRecords[0].signed.signature.value).toBe(issued.signed.signature.value);
  });

  it("allows members only, validates periods, redacts private projects, and caps issuance", async () => {
    const { maya, p, project } = await seedWork();
    const ari = await createUser(ctx.db, "ari");
    expect((await client(ctx.app).post("/me/work-records", { owner: p.owner, slug: p.slug })).status).toBe(401);
    expect((await client(ctx.app, ari).post("/me/work-records", { owner: p.owner, slug: p.slug })).status).toBe(403);
    expect((await client(ctx.app, maya).post("/me/work-records", { owner: p.owner, slug: p.slug, from: "2026-12-01", to: "2026-01-01" })).status).toBe(400);
    expect((await client(ctx.app, maya).post("/me/work-records", { owner: p.owner, slug: p.slug, from: "2015-01-01" })).status).toBe(400);

    await ctx.db.project.update({ where: { id: project.id }, data: { visibility: "PRIVATE" } });
    const priv = await client(ctx.app, maya).post("/me/work-records", { owner: p.owner, slug: p.slug, from });
    expect(priv.body.signed.record).toMatchObject({ project: { name: null, url: null, visibility: "PRIVATE" }, evidence: [], tasks: [], summary: { pullRequestsMerged: 2 } });
    expect(JSON.stringify(priv.body.signed.record)).not.toMatch(/Token bucket|PR 1|Relay API/);

    await ctx.db.workRecord.createMany({
      data: Array.from({ length: 19 }, () => ({ userId: maya.id, projectId: project.id, kid: "k", canonical: "{}", signature: "s", periodFrom: new Date(), periodTo: new Date() })),
    });
    expect((await client(ctx.app, maya).post("/me/work-records", { owner: p.owner, slug: p.slug })).status).toBe(429);
  });
});

describe("audit regressions", () => {
  it("keeps editor tokens away from account-level actions", async () => {
    const raj = await createUser(ctx.db, "raj");
    const p = await newProject(raj);
    const link = await client(ctx.app, raj).post("/auth/device/link", {});
    const token = (await ctx.app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceCode: link.body.deviceCode } })).json().accessToken;
    const as = (method: "POST" | "DELETE" | "PATCH", url: string, payload?: unknown) => ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
    expect((await as("POST", "/auth/device/link", {})).statusCode).toBe(403);
    expect((await as("DELETE", "/me", { confirm: "raj" })).statusCode).toBe(403);
    expect((await as("DELETE", `/projects/${p.owner}/${p.slug}`, { confirm: p.slug })).statusCode).toBe(403);
    expect((await as("PATCH", `/projects/${p.owner}/${p.slug}`, { visibility: "PRIVATE" })).statusCode).toBe(403);
    // Everyday work still goes through.
    expect((await as("POST", `/projects/${p.owner}/${p.slug}/tasks`, { title: "From the editor" })).statusCode).toBe(201);
    // The security note arrives when the device actually connects.
    expect(await ctx.db.notification.count({ where: { recipientId: raj.id, type: "security.device_signed_in" } })).toBe(1);
  });

  it("shows visitors only the public slice of activity", async () => {
    const raj = await createUser(ctx.db, "raj");
    const p = await newProject(raj, { visibility: "PUBLIC" });
    const project = await ctx.db.project.findFirstOrThrow({ where: { slug: p.slug } });
    await client(ctx.app, raj).post(`/projects/${p.owner}/${p.slug}/tasks`, { title: "Secret roadmap item" });
    const priv = await ctx.db.repository.create({ data: { githubId: 77n, ownerLogin: "raj", name: "backend", fullName: "raj/backend", htmlUrl: "https://github.com/raj/backend", defaultBranch: "main", isPrivate: true } });
    await ctx.db.projectRepository.create({ data: { projectId: project.id, repositoryId: priv.id } });
    await ctx.db.activityEvent.createMany({
      data: [
        { projectId: project.id, type: "github.push", source: "GITHUB", externalId: "push:1", trust: "CONNECTED", payload: { repo: "raj/backend", count: 1, messages: ["internal: rotate keys"] }, occurredAt: new Date() },
        { projectId: project.id, type: "github.push", source: "GITHUB", externalId: "push:2", trust: "CONNECTED", payload: { repo: "raj/site", count: 1, messages: ["docs"] }, occurredAt: new Date() },
      ],
    });
    const seen = async (u?: Awaited<ReturnType<typeof createUser>>) =>
      ((await client(ctx.app, u).get(`/projects/${p.owner}/${p.slug}/activity`)).body.items as { type: string; payload: { repo?: string } }[]).map((e) => `${e.type}:${e.payload.repo ?? ""}`);
    const visitor = await seen();
    expect(visitor).toContain("github.push:raj/site");
    expect(visitor).not.toContain("github.push:raj/backend");
    expect(visitor.some((t) => t.startsWith("task."))).toBe(false);
    const member = await seen(raj);
    expect(member).toContain("github.push:raj/backend");
    expect(member.some((t) => t.startsWith("task.created"))).toBe(true);
    // Outsider stats ignore the private repository.
    await ctx.db.pullRequest.create({ data: { githubId: 900n, repositoryId: priv.id, number: 1, title: "x", htmlUrl: "https://github.com/raj/backend/pull/1", state: "MERGED", authorLogin: "raj", headRef: "x", openedAt: new Date(), mergedAt: new Date() } });
    expect((await client(ctx.app).get(`/projects/${p.owner}/${p.slug}`)).body.stats.mergedPrs).toBe(0);
    expect((await client(ctx.app, raj).get(`/projects/${p.owner}/${p.slug}`)).body.stats.mergedPrs).toBe(1);
  });

  it("edits a milestone without resetting its status, and rejects impossible dates", async () => {
    const raj = await createUser(ctx.db, "raj");
    const p = await newProject(raj);
    const base = `/projects/${p.owner}/${p.slug}/milestones`;
    const m = (await client(ctx.app, raj).post(base, { title: "Beta", status: "ACTIVE" })).body;
    expect((await client(ctx.app, raj).patch(`${base}/${m.id}`, { title: "Public beta" })).status).toBe(200);
    expect((await client(ctx.app, raj).get(base)).body.items[0]).toMatchObject({ title: "Public beta", status: "ACTIVE" });
    expect((await client(ctx.app, raj).patch(`${base}/${m.id}`, { dueOn: "2026-02-31" })).status).toBe(400);
  });

  it("stops notifying people once they leave a project", async () => {
    const raj = await createUser(ctx.db, "raj");
    const ari = await createUser(ctx.db, "ari");
    const p = await newProject(raj);
    await addMember(p, raj, ari, "CONTRIBUTOR");
    const t = await client(ctx.app, ari).post(`/projects/${p.owner}/${p.slug}/tasks`, { title: "Ari's task" });
    await client(ctx.app, raj).del(`/projects/${p.owner}/${p.slug}/members/${ari.id}`);
    await client(ctx.app, raj).post(`/projects/${p.owner}/${p.slug}/tasks/${t.body.number}/comments`, { body: "Following up on this" });
    expect(await ctx.db.notification.count({ where: { recipientId: ari.id, type: "task.commented" } })).toBe(0);
  });
});

describe("full-text search", () => {
  it("finds stemmed and prefix matches across tasks, discussions and replies, members only, with safe highlights", async () => {
    const raj = await createUser(ctx.db, "raj");
    const zed = await createUser(ctx.db, "zed");
    const p = await newProject(raj, { visibility: "PRIVATE" });
    const base = `/projects/${p.owner}/${p.slug}`;
    await client(ctx.app, raj).post(`${base}/tasks`, { title: "Session middleware crashes on expired cookies", description: "When the cookie expires mid-request the handler throws." });
    await client(ctx.app, raj).post(`${base}/tasks`, { title: "Unrelated chore", description: "Bump dependencies" });
    await client(ctx.app, raj).post(`${base}/discussions`, { category: "HELP", title: "Login loop", error: { errorMessage: "TypeError: Cannot read properties of undefined (reading 'session')" } });
    await client(ctx.app, raj).post(`${base}/discussions`, { title: "Release plan", body: "Ship after the audit" });
    await client(ctx.app, raj).post(`${base}/discussions/2/replies`, { body: "The crashing handler is fixed by refreshing the session cookie first." });

    const full = (u: typeof raj | undefined, q: string, extra = "") => client(ctx.app, u).get(`/search/full?q=${encodeURIComponent(q)}${extra}`);

    // Stemming: "crashing" finds "crashes"; the reply match surfaces its thread.
    const r = (await full(raj, "crashing")).body;
    expect(r.tasks.map((t: { title: string }) => t.title)).toEqual(["Session middleware crashes on expired cookies"]);
    expect(r.discussions).toEqual([expect.objectContaining({ number: 2, inReply: true })]);
    // Prefix while typing, across words.
    expect((await full(raj, "sess midd")).body.tasks).toHaveLength(1);
    // Error text is searchable; highlights are plain-text parts, odd entries matched.
    const err = (await full(raj, "properties undefined")).body.discussions[0];
    expect(err).toMatchObject({ number: 1, category: "HELP", inReply: false });
    const hl = (await full(raj, "expires")).body.tasks[0].snippet as string[];
    expect(hl.length).toBeGreaterThan(1);
    expect(hl.filter((_, i) => i % 2 === 1).join(" ").toLowerCase()).toContain("expir");

    // Private project: nothing for a non-member or a visitor.
    expect((await full(zed, "crashing")).body).toMatchObject({ tasks: [], discussions: [] });
    expect((await full(undefined, "crashing")).body).toMatchObject({ tasks: [], discussions: [] });

    // Operators and SQL in the query are just words.
    for (const q of ["a & b | !c:*", "'); DROP TABLE \"Task\"; --", "(((", "***"]) expect((await full(raj, q)).status).toBe(200);
    expect(await ctx.db.task.count()).toBe(2);

    // Scoping to a project, single type with paging.
    const other = await newProject(raj, { name: "Other" });
    await client(ctx.app, raj).post(`/projects/${other.owner}/${other.slug}/tasks`, { title: "Session cache warmup" });
    expect((await full(raj, "session", "&type=tasks")).body.tasks).toHaveLength(2);
    expect((await full(raj, "session", `&type=tasks&project=${p.owner}/${p.slug}`)).body.tasks).toHaveLength(1);

    // The palette now includes tasks by meaning and discussions.
    const palette = (await client(ctx.app, raj).get("/search?q=crash")).body;
    expect(palette.tasks.map((t: { title: string }) => t.title)).toContain("Session middleware crashes on expired cookies");
    expect(palette.discussions.map((d: { number: number }) => d.number)).toContain(2);
  });

  it("uses the full-text indexes", async () => {
    const plan = await ctx.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN SELECT 1 FROM "Task" t WHERE (setweight(to_tsvector('english', coalesce(t."title", '')), 'A') || setweight(to_tsvector('english', coalesce(t."description", '')), 'B')) @@ to_tsquery('english', 'crash:*')`,
      );
    });
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain("Task_fts_idx");
  });
});

describe("discussions", () => {
  const ERR = "TypeError: Cannot read properties of undefined (reading 'id')\n    at handler (/home/maya/relay/src/routes/user.ts:42:17)";

  it("runs a help thread from error to accepted answer, and finds it again for the same error elsewhere", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const vic = await createUser(ctx.db, "vic");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "CONTRIBUTOR");
    await addMember(p, maya, vic, "VIEWER");
    const base = `/projects/${p.owner}/${p.slug}/discussions`;

    // Absolute paths would leak home directories.
    expect((await client(ctx.app, ari).post(base, { category: "HELP", title: "Crash", error: { errorMessage: ERR, filePath: "/home/ari/x.ts" } })).status).toBe(400);
    // An error belongs in Help.
    expect((await client(ctx.app, ari).post(base, { category: "IDEAS", title: "Crash", error: { errorMessage: ERR } })).status).toBe(400);
    // Viewers read, contributors post; announcements are for maintainers.
    expect((await client(ctx.app, vic).post(base, { title: "Hello there" , body: "x" })).status).toBe(403);
    expect((await client(ctx.app, ari).post(base, { category: "ANNOUNCEMENTS", title: "Launch", body: "x" })).status).toBe(403);

    const asked = await client(ctx.app, ari).post(base, {
      category: "HELP",
      title: "User route crashes on missing session",
      error: { errorMessage: ERR, language: "typescript", filePath: "src/routes/user.ts", line: 42, codeSnippet: "const id = req.user.id;", branch: "ari/relay-7", commitSha: "4A1C9E2" },
    });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    expect(asked.body.discussion).toMatchObject({ number: 1, category: "HELP", solved: false, errorHeadline: "TypeError: Cannot read properties of undefined (reading 'id')" });
    // Help reaches the whole team except the asker.
    expect(await ctx.db.notification.count({ where: { type: "discussion.help" } })).toBe(2);

    const r1 = await client(ctx.app, maya).post(`${base}/1/replies`, { body: "Guard it: `req.user?.id`, and return 401 first. cc @ari" });
    expect(r1.status).toBe(201);
    const r2 = await client(ctx.app, vic).post(`${base}/1/replies`, { body: "me too" });
    expect(r2.status).toBe(403);

    // Helpful votes: not on your own reply, toggles.
    expect((await client(ctx.app, maya).post(`${base}/1/replies/${r1.body.id}/vote`)).status).toBe(400);
    expect((await client(ctx.app, ari).post(`${base}/1/replies/${r1.body.id}/vote`)).body).toEqual({ voted: true, helpful: 1 });
    expect((await client(ctx.app, vic).post(`${base}/1/replies/${r1.body.id}/vote`)).body).toEqual({ voted: true, helpful: 2 });
    expect((await client(ctx.app, vic).post(`${base}/1/replies/${r1.body.id}/vote`)).body).toEqual({ voted: false, helpful: 1 });

    // Only the asker or a maintainer accepts.
    expect((await client(ctx.app, vic).post(`${base}/1/answer`, { replyId: r1.body.id })).status).toBe(403);
    expect((await client(ctx.app, ari).post(`${base}/1/answer`, { replyId: r1.body.id })).status).toBe(200);
    expect(await ctx.db.notification.count({ where: { type: "discussion.answered", recipientId: maya.id } })).toBe(1);

    const detail = await client(ctx.app, ari).get(`${base}/1`);
    expect(detail.body).toMatchObject({ solved: true, answerId: r1.body.id, replyCount: 1, viewer: { canAnswer: true, canReply: true } });
    expect(detail.body.error).toMatchObject({ filePath: "src/routes/user.ts", line: 42, commitSha: "4a1c9e2", fileUrl: null });
    expect(detail.body.replies[0]).toMatchObject({ isAnswer: true, helpful: 1, votedByMe: true });

    // The same error in another project, from another machine, finds the solved thread.
    const other = await newProject(ari, { name: "Gateway" });
    const winErr = "TypeError: Cannot read properties of undefined (reading 'id')\n    at handler (C:\\Users\\ari\\gw\\src\\auth.ts:9:3)";
    const similar = await client(ctx.app, ari).post(`/projects/${other.owner}/${other.slug}/discussions/similar`, { errorMessage: winErr });
    expect(similar.body.items).toEqual([expect.objectContaining({ number: 1, solved: true, project: expect.objectContaining({ slug: p.slug }), answer: expect.objectContaining({ excerpt: expect.stringContaining("req.user?.id") }) })]);
    // ...but never across a project you are not in.
    const stranger = await createUser(ctx.db, "zed");
    const theirs = await newProject(stranger, { name: "Theirs" });
    expect((await client(ctx.app, stranger).post(`/projects/${theirs.owner}/${theirs.slug}/discussions/similar`, { errorMessage: winErr })).body.items).toEqual([]);

    // Deleting the accepted reply re-opens the thread.
    await client(ctx.app, maya).del(`${base}/1/replies/${r1.body.id}`);
    expect((await client(ctx.app, ari).get(`${base}/1`)).body).toMatchObject({ solved: false, replyCount: 0 });
  });

  it("lists with pinned threads first, filters, search, and locking", async () => {
    const maya = await createUser(ctx.db, "maya");
    const ari = await createUser(ctx.db, "ari");
    const p = await newProject(maya);
    await addMember(p, maya, ari, "CONTRIBUTOR");
    const base = `/projects/${p.owner}/${p.slug}/discussions`;
    await client(ctx.app, maya).post(base, { category: "ANNOUNCEMENTS", title: "Read me first", body: "Rules" });
    await client(ctx.app, ari).post(base, { category: "IDEAS", title: "Dark mode for the badge", body: "Would be nice" });
    await client(ctx.app, ari).post(base, { category: "HELP", title: "Redis refuses", error: { errorMessage: "Error: connect ECONNREFUSED 127.0.0.1:6379" } });

    expect((await client(ctx.app, ari).patch(`${base}/1`, { pinned: true })).status).toBe(403);
    expect((await client(ctx.app, maya).patch(`${base}/1`, { pinned: true })).status).toBe(200);
    const list = await client(ctx.app, ari).get(base);
    expect(list.body.pinned.map((d: { number: number }) => d.number)).toEqual([1]);
    expect(list.body.items.map((d: { number: number }) => d.number)).toEqual([3, 2]);
    expect((await client(ctx.app, ari).get(`${base}?category=HELP&status=open`)).body.items.map((d: { number: number }) => d.number)).toEqual([3]);
    expect((await client(ctx.app, ari).get(`${base}?q=econnrefused`)).body.items.map((d: { number: number }) => d.number)).toEqual([3]);
    expect((await client(ctx.app).get(base)).status).toBe(403);

    // Locked: members cannot reply, maintainers still can.
    await client(ctx.app, maya).patch(`${base}/2`, { locked: true });
    expect((await client(ctx.app, ari).post(`${base}/2/replies`, { body: "+1" })).status).toBe(403);
    expect((await client(ctx.app, maya).post(`${base}/2/replies`, { body: "Closing this one" })).status).toBe(201);
    // Authors edit their own thread; a help thread cannot be moved out of Help.
    expect((await client(ctx.app, ari).patch(`${base}/3`, { category: "GENERAL" })).status).toBe(400);
    expect((await client(ctx.app, ari).patch(`${base}/3`, { title: "Redis refuses connections locally" })).status).toBe(200);
  });
});

describe("presence and huddles", () => {
  async function team() {
    const raj = await createUser(ctx.db, "raj");
    const ari = await createUser(ctx.db, "ari");
    const zed = await createUser(ctx.db, "zed");
    const p = await newProject(raj);
    await addMember(p, raj, ari, "CONTRIBUTOR");
    await client(ctx.app, raj).post(`/projects/${p.owner}/${p.slug}/tasks`, { title: "Token bucket" });
    return { raj, ari, zed, p };
  }
  const beat = (u: Awaited<ReturnType<typeof createUser>>, p: { owner: string; slug: string }, extra: Record<string, unknown> = {}) =>
    ctx.app.inject({ method: "PUT", url: "/me/presence", headers: { cookie: u.cookie, origin: ORIGIN, "content-type": "application/json" }, payload: { owner: p.owner, slug: p.slug, ...extra } });

  it("shows who is working on what to members only, and warns about the same file", async () => {
    const { raj, ari, zed, p } = await team();
    expect((await beat(ari, p, { branch: "ari/relay-1-bucket", filePath: "src/bucket.ts", taskNumber: 1 })).json().overlaps).toEqual([]);
    expect((await beat(zed, p)).statusCode).toBe(403);
    expect((await beat(raj, p, { filePath: "C:\\Users\\raj\\x.ts" })).statusCode).toBe(400);

    // Same file on another branch: Raj is warned in the response, Ari through a notification.
    const r = (await beat(raj, p, { branch: "main", filePath: "src/bucket.ts" })).json();
    expect(r.overlaps).toEqual([expect.objectContaining({ user: expect.objectContaining({ username: "ari" }), filePath: "src/bucket.ts", branch: "ari/relay-1-bucket", sameBranch: false })]);
    await beat(raj, p, { branch: "main", filePath: "src/bucket.ts" });
    expect(await ctx.db.notification.count({ where: { recipientId: ari.id, type: "presence.overlap" } })).toBe(1);

    const list = (await client(ctx.app, raj).get(`/projects/${p.owner}/${p.slug}/presence`)).body.items;
    expect(list).toHaveLength(2);
    expect(list.find((e: { user: { username: string } }) => e.user.username === "ari")).toMatchObject({ branch: "ari/relay-1-bucket", filePath: "src/bucket.ts", task: { identifier: "RELAY-1", title: "Token bucket" } });
    expect((await client(ctx.app, zed).get(`/projects/${p.owner}/${p.slug}/presence`)).status).toBe(403);
    expect((await client(ctx.app).get(`/projects/${p.owner}/${p.slug}/presence`)).status).toBe(401);

    // The team view excludes yourself.
    const t = (await client(ctx.app, raj).get("/me/team")).body.items;
    expect(t).toEqual([expect.objectContaining({ project: expect.objectContaining({ slug: p.slug }), people: [expect.objectContaining({ user: expect.objectContaining({ username: "ari" }) })] })]);

    // Gone quiet: dropped (and pruned) after the freshness window. Explicit leave is immediate.
    const project = await ctx.db.project.findFirstOrThrow({ where: { slug: p.slug } });
    const stored = JSON.parse((await ctx.app.deps.redis.hget(`pres:${project.id}`, ari.id))!);
    await ctx.app.deps.redis.hset(`pres:${project.id}`, ari.id, JSON.stringify({ ...stored, at: Date.now() - 120_000 }));
    expect((await client(ctx.app, raj).get(`/projects/${p.owner}/${p.slug}/presence`)).body.items.map((e: { user: { username: string } }) => e.user.username)).toEqual(["raj"]);
    expect(await ctx.app.deps.redis.hexists(`pres:${project.id}`, ari.id)).toBe(0);
    await client(ctx.app, raj).del(`/me/presence?owner=${p.owner}&slug=${p.slug}`);
    expect((await client(ctx.app, raj).get(`/projects/${p.owner}/${p.slug}/presence`)).body.items).toEqual([]);
  });

  it("starts huddles and pairing sessions for project members", async () => {
    const { raj, ari, zed, p } = await team();
    const base = `/projects/${p.owner}/${p.slug}/huddles`;
    // Nobody online and nobody picked.
    expect((await client(ctx.app, raj).post(base, {})).status).toBe(400);
    // Invitees must be members.
    expect((await client(ctx.app, raj).post(base, { invitees: [zed.id] })).status).toBe(400);

    await beat(ari, p);
    const h = await client(ctx.app, raj).post(base, { topic: "Bucket refill bug" });
    expect(h.status).toBe(201);
    expect(h.body).toMatchObject({ invited: 1, huddle: { kind: "HUDDLE", topic: "Bucket refill bug", active: true } });
    expect(h.body.huddle.url).toMatch(/^https:\/\/meet\.jit\.si\/bldt-relay-api-[0-9a-f]{12}$/);
    const n = await ctx.db.notification.findFirstOrThrow({ where: { recipientId: ari.id, type: "huddle.invite" } });
    expect(n.data).toMatchObject({ url: h.body.huddle.url, host: "RAJ" });

    // A personal meeting room is used when set; non-https is refused at the profile.
    expect((await client(ctx.app, raj).patch("/me", { meetingUrl: "http://zoom.example/x" })).status).toBe(400);
    await client(ctx.app, raj).patch("/me", { meetingUrl: "https://meet.google.com/abc-defg-hij" });
    expect((await client(ctx.app, raj).post(base, { invitees: [ari.id] })).body.huddle.url).toBe("https://meet.google.com/abc-defg-hij");

    // Pairing carries a Live Share link, and only that.
    expect((await client(ctx.app, raj).post(base, { kind: "PAIR", invitees: [ari.id], url: "https://evil.example/join?x=1" })).status).toBe(400);
    const pair = await client(ctx.app, raj).post(base, { kind: "PAIR", invitees: [ari.id], url: "https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC123DEF" });
    expect(pair.status).toBe(201);

    const mine = (await client(ctx.app, ari).get("/me/huddles")).body.items;
    expect(mine).toHaveLength(3);
    expect((await client(ctx.app, zed).get("/me/huddles")).body.items).toEqual([]);
    expect((await client(ctx.app, ari).post(`/huddles/${pair.body.huddle.id}/end`)).status).toBe(403);
    expect((await client(ctx.app, raj).post(`/huddles/${pair.body.huddle.id}/end`)).status).toBe(200);
    expect((await client(ctx.app, ari).get("/me/huddles")).body.items).toHaveLength(2);
  });
});

describe("device sign-in", () => {
  const start = async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/auth/device/code", payload: { clientName: "VS Code on raj-laptop" } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { deviceCode: string; userCode: string; verificationUriComplete: string; interval: number };
  };
  const poll = (deviceCode: string) => ctx.app.inject({ method: "POST", url: "/auth/device/token", payload: { deviceCode } });
  const bearer = (token: string, method: "GET" | "POST", url: string, payload?: unknown) =>
    ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

  it("signs an editor in after browser approval, once, with a token that only works as a bearer", async () => {
    const raj = await createUser(ctx.db, "raj");
    const d = await start();
    expect(d.userCode).toMatch(/^[B-Z]{4}-[B-Z]{4}$/);
    expect(d.userCode).not.toMatch(/[AEIOU]/);
    expect(d.verificationUriComplete).toBe(`${ORIGIN}/device?code=${d.userCode}`);

    const pending = await poll(d.deviceCode);
    expect(pending.json().error.code).toBe("authorization_pending");
    // Polling again immediately is too fast.
    expect((await poll(d.deviceCode)).json().error.code).toBe("slow_down");

    // The approval page shows what is asking; lower case and no dash still match.
    const info = await client(ctx.app, raj).get(`/auth/device/${d.userCode.toLowerCase().replace("-", "")}`);
    expect(info.body).toMatchObject({ clientName: "VS Code on raj-laptop", status: "PENDING" });
    expect((await client(ctx.app).get(`/auth/device/${d.userCode}`)).status).toBe(401);
    expect((await client(ctx.app, raj).post(`/auth/device/${d.userCode}/approve`)).status).toBe(200);

    await ctx.db.deviceAuthorization.updateMany({ data: { lastPolledAt: null } });
    const granted = await poll(d.deviceCode);
    expect(granted.statusCode).toBe(200);
    const { accessToken, user } = granted.json();
    expect(accessToken).toMatch(/^bldt_/);
    expect(user).toMatchObject({ username: "raj" });
    // Single use.
    expect((await poll(d.deviceCode)).json().error.code).toBe("invalid_grant");

    // Works as a bearer, including writes without an Origin header (no ambient credential, no CSRF).
    const me = await bearer(accessToken, "GET", "/me");
    expect(me.json()).toMatchObject({ username: "raj" });
    const created = await bearer(accessToken, "POST", "/projects", { name: "From VS Code", visibility: "PRIVATE" });
    expect(created.statusCode).toBe(201);
    // Never as a cookie, and a forged or unknown token is rejected outright.
    expect((await ctx.app.inject({ method: "GET", url: "/me", headers: { cookie: `bldt_session=${accessToken}` } })).statusCode).toBe(401);
    expect((await bearer("bldt_nope", "GET", "/me")).statusCode).toBe(401);
    expect((await bearer("not-ours", "GET", "/me")).statusCode).toBe(401);

    // Listed in sessions by name, and revocable from the browser.
    const sessions = await client(ctx.app, raj).get("/me/sessions");
    const device = sessions.body.items.find((s: { kind: string }) => s.kind === "DEVICE");
    expect(device).toMatchObject({ clientName: "VS Code on raj-laptop" });
    expect((await client(ctx.app, raj).del(`/me/sessions/${device.id}`)).status).toBe(200);
    expect((await bearer(accessToken, "GET", "/me")).statusCode).toBe(401);

    // The approval left a security note in the inbox.
    expect(await ctx.db.notification.count({ where: { recipientId: raj.id, type: "security.device_signed_in" } })).toBe(1);
  });

  it("connects an editor in one click from the browser, once, and only for the signed-in person", async () => {
    const raj = await createUser(ctx.db, "raj");
    expect((await client(ctx.app).post("/auth/device/link", {})).status).toBe(401);
    // Another site cannot trigger it with the person's cookie.
    const forged = await ctx.app.inject({ method: "POST", url: "/auth/device/link", headers: { cookie: raj.cookie, origin: "https://evil.example", "content-type": "application/json" }, payload: "{}" });
    expect(forged.statusCode).toBe(403);

    const link = await client(ctx.app, raj).post("/auth/device/link", { clientName: "VS Code" });
    expect(link.status).toBe(200);
    expect(link.body.expiresIn).toBe(120);
    const granted = await poll(link.body.deviceCode);
    expect(granted.statusCode).toBe(200);
    expect(granted.json().user).toMatchObject({ username: "raj" });
    expect((await poll(link.body.deviceCode)).json().error.code).toBe("invalid_grant");

    const late = await client(ctx.app, raj).post("/auth/device/link", {});
    await ctx.db.deviceAuthorization.updateMany({ where: { status: "APPROVED" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await poll(late.body.deviceCode)).json().error.code).toBe("expired_token");
  });

  it("handles denial, expiry and bad codes", async () => {
    const raj = await createUser(ctx.db, "raj");
    const denied = await start();
    expect((await client(ctx.app, raj).post(`/auth/device/${denied.userCode}/deny`)).status).toBe(200);
    expect((await poll(denied.deviceCode)).json().error.code).toBe("access_denied");
    // Cannot approve after denying.
    expect((await client(ctx.app, raj).post(`/auth/device/${denied.userCode}/approve`)).status).toBe(404);

    const late = await start();
    await ctx.db.deviceAuthorization.updateMany({ where: { userCode: late.userCode }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await poll(late.deviceCode)).json().error.code).toBe("expired_token");
    expect((await client(ctx.app, raj).post(`/auth/device/${late.userCode}/approve`)).status).toBe(404);

    expect((await poll("x".repeat(30))).json().error.code).toBe("invalid_grant");
    expect((await client(ctx.app, raj).get("/auth/device/AAAA")).status).toBe(404);
  });
});

describe("webhooks", () => {
  it("verifies signatures, stores deliveries once, and enqueues processing", async () => {
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const send = () =>
      ctx.app.inject({
        method: "POST",
        url: "/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sign(body),
          "x-github-delivery": "d-1",
          "x-github-event": "ping",
        },
        payload: body,
      });
    expect((await send()).statusCode).toBe(202);
    expect((await send()).statusCode).toBe(202);
    expect(await ctx.db.webhookDelivery.count()).toBe(1);
    expect(ctx.jobs.filter((j) => j.name === "webhook.process")).toHaveLength(1);
  });
});

async function addMember(
  p: { owner: string; slug: string },
  owner: Awaited<ReturnType<typeof createUser>>,
  user: Awaited<ReturnType<typeof createUser>>,
  role: "MAINTAINER" | "CONTRIBUTOR" | "VIEWER",
) {
  const inv = await client(ctx.app, owner).post(`/projects/${p.owner}/${p.slug}/invitations`, { username: user.username, role });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const res = await client(ctx.app, user).post(`/invitations/${inv.body.id}/respond`, { accept: true });
  expect(res.status).toBe(200);
}
