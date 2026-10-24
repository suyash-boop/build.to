import { keepKnownRefs, knownRefs, type Ai, type BriefInput, type ReleaseNotesInput } from "@bldt/ai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { client, createUser, reset, setup, type TestContext } from "./helpers.ts";

/** A stand-in for the model: records inputs, returns deterministic output, and invents a bogus ref. */
const calls: { brief: BriefInput[]; notes: ReleaseNotesInput[] } = { brief: [], notes: [] };
const fakeAi: Ai = {
  async projectBrief(input) {
    calls.brief.push(input);
    const raw = {
      summary: `${input.project.name} is ${input.project.stage.toLowerCase()}.`,
      recent: [{ text: "Work landed", refs: [...input.recentlyDone.map((t) => t.id), "RELAY-999"] }],
      next: input.openTasks.slice(0, 1).map((t) => ({ text: t.title, refs: [t.id] })),
      risks: [],
    };
    return keepKnownRefs(raw, knownRefs(input));
  },
  async releaseNotes(input) {
    calls.notes.push(input);
    return { title: "Draft", notes: input.completedTasks.map((t) => `- ${t.title} (${t.id})`).join("\n") };
  },
};

let ctx: TestContext;
let off: TestContext;
beforeAll(async () => {
  ctx = await setup({ ai: fakeAi });
  off = await setup();
});
afterAll(async () => {
  await ctx.close();
  await off.close();
});
beforeEach(async () => {
  await reset(ctx.db);
  calls.brief.length = 0;
  calls.notes.length = 0;
});

async function project() {
  const maya = await createUser(ctx.db, "maya");
  const api = client(ctx.app, maya);
  expect((await api.post("/projects", { name: "Relay", visibility: "PUBLIC" })).status).toBe(201);
  await api.post("/projects/maya/relay/tasks", { title: "Token bucket" });
  await api.post("/projects/maya/relay/tasks", { title: "Sliding window" });
  await api.patch("/projects/maya/relay/tasks/1", { status: "DONE" });
  return { maya, api };
}

describe("project briefs", () => {
  it("generates, stores, and serves a brief with only real references", async () => {
    const { api } = await project();
    expect((await api.get("/projects/maya/relay/brief")).body).toEqual({ brief: null, enabled: true });

    const res = await api.post("/projects/maya/relay/brief");
    expect(res.status).toBe(200);
    expect(res.body.brief.recent[0].refs).toEqual(["RELAY-1"]);
    expect(res.body.brief.next[0].refs).toEqual(["RELAY-2"]);
    expect(res.body.brief.generatedBy.username).toBe("maya");

    const stored = await api.get("/projects/maya/relay/brief");
    expect(stored.body.brief.summary).toBe("Relay is building.");
    // The model saw task data, never anything outside this project.
    expect(calls.brief[0]!.openTasks.map((t) => t.id)).toEqual(["RELAY-2"]);
  });

  it("enforces a cooldown between regenerations", async () => {
    const { api } = await project();
    expect((await api.post("/projects/maya/relay/brief")).status).toBe(200);
    expect((await api.post("/projects/maya/relay/brief")).status).toBe(409);
    expect(calls.brief).toHaveLength(1);
  });

  it("keeps briefs away from non-members, even on public projects", async () => {
    await project();
    const eve = await createUser(ctx.db, "eve");
    expect((await client(ctx.app, eve).get("/projects/maya/relay/brief")).status).toBe(403);
    expect((await client(ctx.app).get("/projects/maya/relay/brief")).status).toBe(403);
  });

  it("reports AI as disabled when no key is configured", async () => {
    await reset(off.db);
    const maya = await createUser(off.db, "maya");
    const api = client(off.app, maya);
    await api.post("/projects", { name: "Relay" });
    expect((await api.get("/projects/maya/relay/brief")).body.enabled).toBe(false);
    const res = await api.post("/projects/maya/relay/brief");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ai_disabled");
    expect((await api.get("/me")).body.features).toEqual({ ai: false });
  });
});

describe("release note drafts", () => {
  it("drafts from work completed since the last release, and only for people who can ship", async () => {
    const { maya, api } = await project();
    const draft = await api.post("/projects/maya/relay/releases/draft");
    expect(draft.status).toBe(200);
    expect(draft.body.notes).toContain("RELAY-1");
    expect(draft.body.basedOn.tasks).toBe(1);

    await api.post("/projects/maya/relay/ship", { title: "v1" });
    // Nothing new since the ship.
    expect((await api.post("/projects/maya/relay/releases/draft")).status).toBe(404);

    const ari = await createUser(ctx.db, "ari");
    const inv = await api.post("/projects/maya/relay/invitations", { username: "ari", role: "CONTRIBUTOR" });
    await client(ctx.app, ari).post(`/invitations/${inv.body.id}/respond`, { accept: true });
    expect((await client(ctx.app, ari).post("/projects/maya/relay/releases/draft")).status).toBe(403);
    void maya;
  });
});
