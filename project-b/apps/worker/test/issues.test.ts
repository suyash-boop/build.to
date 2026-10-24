import { Encrypter } from "@bldt/core";
import { createDb, requireLocalTestDatabase, type Db } from "@bldt/db";
import type { JobClient } from "@bldt/jobs";
import { pino } from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/context.ts";
import { processWebhook } from "../src/jobs/webhook.ts";
import { mirrorIssue, nextStatus, type GhIssue } from "../src/mirror.ts";

const db: Db = createDb(requireLocalTestDatabase(process.env.WORKER_TEST_DATABASE_URL, "WORKER_TEST_DATABASE_URL"), { max: 4 });
const deps: WorkerDeps = {
  db,
  github: {} as WorkerDeps["github"],
  jobs: { enqueue: async () => undefined } as unknown as JobClient,
  log: pino({ level: "silent" }),
  encrypter: new Encrypter(Buffer.alloc(32, 7).toString("base64")),
  webOrigin: "https://bld.test",
  allowPrivateWebhooks: false,
};

let projectId: string;
let ownerId: string;
let memberId: string;
let repo: { id: string; fullName: string };

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "ActivityEvent","Task","ProjectRepository","ProjectMember","Project","Repository","WebhookDelivery","GithubAccount","User" RESTART IDENTITY CASCADE`);
  const owner = await db.user.create({ data: { username: "owner", displayName: "Owner" } });
  const member = await db.user.create({ data: { username: "member", displayName: "Member", githubAccount: { create: { githubUserId: 700n, login: "member-gh", accessToken: "x" } } } });
  ownerId = owner.id;
  memberId = member.id;
  const r = await db.repository.create({
    data: { githubId: 5001n, ownerLogin: "org", name: "app", fullName: "org/app", htmlUrl: "https://github.com/org/app", defaultBranch: "main", isPrivate: false },
  });
  repo = { id: r.id, fullName: r.fullName };
  const p = await db.project.create({
    data: {
      ownerId,
      slug: "app",
      key: "APP",
      name: "App",
      members: { create: [{ userId: ownerId, role: "OWNER" }, { userId: memberId, role: "CONTRIBUTOR" }] },
      repositories: { create: { repositoryId: r.id, isPrimary: true } },
    },
  });
  projectId = p.id;
});

const issue = (over: Partial<GhIssue> = {}): GhIssue => ({
  id: 9100,
  number: 34,
  title: "Login fails on Safari",
  body: "Steps to reproduce...",
  html_url: "https://github.com/org/app/issues/34",
  state: "open",
  state_reason: null,
  created_at: "2026-09-20T10:00:00Z",
  closed_at: null,
  user: { login: "member-gh", id: 700 },
  assignees: [{ login: "member-gh", id: 700 }],
  ...over,
});
const tasks = () => db.task.findMany({ where: { projectId }, orderBy: { number: "asc" } });

describe("GitHub issues as tasks", () => {
  it("imports an issue once, with its author and assignee mapped to members", async () => {
    expect(await mirrorIssue(deps, repo, issue())).toEqual([projectId]);
    expect(await mirrorIssue(deps, repo, issue())).toEqual([]);
    const [t] = await tasks();
    expect(t).toMatchObject({ number: 1, title: "Login fails on Safari", status: "TODO", githubIssueNumber: 34, githubIssueUrl: "https://github.com/org/app/issues/34", creatorId: memberId, assigneeId: memberId });
    expect((await tasks())).toHaveLength(1);
  });

  it("falls back to the owner as creator, and ignores pull requests", async () => {
    await mirrorIssue(deps, repo, issue({ id: 9200, user: { login: "stranger", id: 999 }, assignees: [] }));
    expect((await tasks())[0]).toMatchObject({ creatorId: ownerId, assigneeId: null });
    expect(await mirrorIssue(deps, repo, issue({ id: 9300, pull_request: {} }))).toEqual([]);
    expect(await tasks()).toHaveLength(1);
  });

  it("follows GitHub transitions without undoing work done in bld.t", () => {
    const open = issue();
    const done = issue({ state: "closed", state_reason: "completed" });
    const notPlanned = issue({ state: "closed", state_reason: "not_planned" });
    expect(nextStatus("IN_PROGRESS", "open", open)).toBe("IN_PROGRESS");
    expect(nextStatus("IN_REVIEW", "open", open)).toBe("IN_REVIEW");
    // Finished in bld.t while the issue stays open: a sync must not undo it.
    expect(nextStatus("DONE", "open", open)).toBe("DONE");
    expect(nextStatus("CANCELED", "open", open)).toBe("CANCELED");
    // A real reopen on GitHub (closed before, open now) brings it back.
    expect(nextStatus("DONE", "closed", open)).toBe("TODO");
    expect(nextStatus("IN_PROGRESS", "open", done)).toBe("DONE");
    expect(nextStatus("TODO", "open", notPlanned)).toBe("CANCELED");
    expect(nextStatus("CANCELED", "open", done)).toBe("CANCELED");
  });

  it("keeps a task finished by a merged pull request done when the next sync sees the issue still open", async () => {
    await mirrorIssue(deps, repo, issue({ updated_at: "2026-09-20T10:00:00Z" }));
    await db.task.updateMany({ where: { projectId }, data: { status: "DONE", completedAt: new Date() } });
    await mirrorIssue(deps, repo, issue({ updated_at: "2026-09-21T10:00:00Z" }));
    expect((await tasks())[0]).toMatchObject({ status: "DONE" });
  });

  it("ignores snapshots older than the one applied, and skips writes when nothing changed", async () => {
    await mirrorIssue(deps, repo, issue({ updated_at: "2026-09-22T10:00:00Z", title: "Newest title" }));
    await mirrorIssue(deps, repo, issue({ updated_at: "2026-09-21T10:00:00Z", title: "Stale title", state: "closed", state_reason: "completed" }));
    expect((await tasks())[0]).toMatchObject({ title: "Newest title", status: "TODO" });
    const before = (await tasks())[0]!.updatedAt;
    await new Promise((r) => setTimeout(r, 20));
    await mirrorIssue(deps, repo, issue({ updated_at: "2026-09-23T10:00:00Z", title: "Newest title" }));
    const after = (await tasks())[0]!;
    expect(after.updatedAt.getTime()).toBe(before.getTime());
    expect(after.githubUpdatedAt?.toISOString()).toBe("2026-09-23T10:00:00.000Z");
  });

  it("keeps the task current through webhooks, and records opens and closes in the feed", async () => {
    let n = 0;
    const deliver = async (action: string, payload: GhIssue) => {
      const id = `d-${++n}`;
      await db.webhookDelivery.create({ data: { id, event: "issues" } });
      await processWebhook(deps, id, "issues", { action, issue: payload, repository: { id: 5001 }, sender: { login: "member-gh", id: 700 } });
    };
    await deliver("opened", issue());
    await db.task.updateMany({ where: { projectId }, data: { status: "IN_PROGRESS", priority: "HIGH" } });
    await deliver("edited", issue({ title: "Login fails on Safari 17" }));
    expect((await tasks())[0]).toMatchObject({ title: "Login fails on Safari 17", status: "IN_PROGRESS", priority: "HIGH" });
    await deliver("closed", issue({ state: "closed", state_reason: "completed", closed_at: "2026-10-01T09:00:00Z" }));
    expect((await tasks())[0]).toMatchObject({ status: "DONE" });
    await deliver("reopened", issue());
    expect((await tasks())[0]).toMatchObject({ status: "TODO", completedAt: null });
    await deliver("deleted", issue());
    expect((await tasks())[0]).toMatchObject({ status: "CANCELED" });

    const feed = await db.activityEvent.findMany({ where: { projectId }, orderBy: { occurredAt: "asc" } });
    expect(feed.map((e) => e.type)).toEqual(["task.created", "task.completed"]);
    expect(feed[0]).toMatchObject({ source: "GITHUB", trust: "CONNECTED", actorId: memberId });
  });
});
