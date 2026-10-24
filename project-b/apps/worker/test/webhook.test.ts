import { Encrypter } from "@bldt/core";
import { createDb, requireLocalTestDatabase, type Db } from "@bldt/db";
import type { JobClient } from "@bldt/jobs";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/context.ts";
import { processWebhook } from "../src/jobs/webhook.ts";
import { recomputeProject } from "../src/jobs/recompute.ts";
import { runMaintenance } from "../src/jobs/maintenance.ts";

const db: Db = createDb(requireLocalTestDatabase(process.env.WORKER_TEST_DATABASE_URL, "WORKER_TEST_DATABASE_URL"), { max: 4 });
const enqueued: { name: string; data: unknown }[] = [];
const deps: WorkerDeps = {
  db,
  github: {} as WorkerDeps["github"],
  jobs: { enqueue: async (name: string, data: unknown) => void enqueued.push({ name, data }) } as unknown as JobClient,
  log: pino({ level: "silent" }),
  encrypter: new Encrypter(Buffer.alloc(32, 7).toString("base64")),
  webOrigin: "https://bld.test",
  allowPrivateWebhooks: false,
};

let seq = 0;
async function deliver(event: string, payload: Record<string, unknown>) {
  const id = `delivery-${++seq}`;
  await db.webhookDelivery.create({ data: { id, event } });
  await processWebhook(deps, id, event, payload);
  return db.webhookDelivery.findUniqueOrThrow({ where: { id } });
}

let projectId: string;
let repoGithubId: number;

beforeAll(async () => {});
afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`
    TRUNCATE "ActivityEvent","Notification","AuditLog","WebhookDelivery","Comment","PullRequestTask","PullRequest",
      "Task","Milestone","Release","Deployment","Contribution","ProjectTechnology","Invitation","JoinRequest",
      "ProjectRepository","ProjectMember","Project","Repository","GithubInstallation","Session","GithubAccount","User"
    RESTART IDENTITY CASCADE`);
  enqueued.length = 0;

  const maya = await db.user.create({
    data: { username: "maya", displayName: "Maya", githubAccount: { create: { githubUserId: 501n, login: "maya-gh", accessToken: "x" } } },
  });
  repoGithubId = 9001;
  const repo = await db.repository.create({
    data: {
      githubId: BigInt(repoGithubId),
      ownerLogin: "maya-gh",
      name: "relay",
      fullName: "maya-gh/relay",
      htmlUrl: "https://github.com/maya-gh/relay",
      defaultBranch: "main",
      isPrivate: false,
      languages: { TypeScript: 9000, Shell: 100, CSS: 900 },
      detectedStack: [{ slug: "fastify", evidence: "package.json" }],
    },
  });
  const project = await db.project.create({
    data: {
      ownerId: maya.id,
      slug: "relay",
      key: "RELAY",
      name: "Relay",
      stage: "BUILDING",
      visibility: "PUBLIC",
      taskCounter: 2,
      members: { create: { userId: maya.id, role: "OWNER" } },
      repositories: { create: { repositoryId: repo.id, isPrimary: true } },
      tasks: {
        create: [
          { number: 1, title: "Token bucket", status: "TODO", position: 1024, creatorId: maya.id },
          { number: 2, title: "Docs", status: "TODO", position: 2048, creatorId: maya.id },
        ],
      },
    },
  });
  projectId = project.id;
});

const repository = () => ({ id: repoGithubId, full_name: "maya-gh/relay", name: "relay", owner: { login: "maya-gh" } });

const pr = (over: Record<string, unknown> = {}) => ({
  id: 77,
  number: 12,
  title: "Implement token bucket",
  body: "Fixes RELAY-1",
  html_url: "https://github.com/maya-gh/relay/pull/12",
  state: "open",
  draft: false,
  merged_at: null,
  closed_at: null,
  created_at: "2026-09-01T10:00:00Z",
  user: { login: "maya-gh", id: 501 },
  head: { ref: "maya/relay-1-bucket" },
  additions: 120,
  deletions: 8,
  changed_files: 4,
  ...over,
});

const task = (n: number) => db.task.findUniqueOrThrow({ where: { projectId_number: { projectId, number: n } } });

describe("pull request webhooks", () => {
  it("moves a referenced task to review on open and to done on merge with a closing keyword", async () => {
    await deliver("pull_request", { action: "opened", repository: repository(), pull_request: pr() });
    expect((await task(1)).status).toBe("IN_REVIEW");
    expect((await task(2)).status).toBe("TODO");

    await deliver("pull_request", {
      action: "closed",
      repository: repository(),
      pull_request: pr({ state: "closed", merged_at: "2026-09-02T10:00:00Z", closed_at: "2026-09-02T10:00:00Z" }),
    });
    const t = await task(1);
    expect(t.status).toBe("DONE");
    expect(t.completedAt).not.toBeNull();

    const types = (await db.activityEvent.findMany({ where: { projectId }, orderBy: { occurredAt: "asc" } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["github.pr_opened", "github.pr_merged", "task.status_changed", "task.completed"]));

    const c = await db.contribution.findFirstOrThrow({ where: { projectId, githubLogin: "maya-gh" } });
    expect(c.prsOpened).toBe(1);
    expect(c.prsMerged).toBe(1);
  });

  it("does not complete tasks merged without a closing keyword", async () => {
    await deliver("pull_request", {
      action: "closed",
      repository: repository(),
      pull_request: pr({ body: "Related to RELAY-2", head: { ref: "docs" }, state: "closed", merged_at: "2026-09-02T10:00:00Z", closed_at: "2026-09-02T10:00:00Z", title: "Docs pass" }),
    });
    expect((await task(2)).status).toBe("TODO");
    expect(await db.pullRequestTask.count()).toBe(1);
  });

  it("is idempotent across redeliveries", async () => {
    const payload = { action: "opened", repository: repository(), pull_request: pr() };
    await deliver("pull_request", payload);
    await deliver("pull_request", payload);
    expect(await db.pullRequest.count()).toBe(1);
    expect(await db.activityEvent.count({ where: { type: "github.pr_opened" } })).toBe(1);
  });

  it("ignores repositories not linked to any project", async () => {
    const d = await deliver("pull_request", { action: "opened", repository: { ...repository(), id: 1 }, pull_request: pr() });
    expect(d.status).toBe("IGNORED");
  });
});

describe("reviews, releases, pushes", () => {
  it("counts a review once and ignores self-review", async () => {
    const review = {
      action: "submitted",
      repository: repository(),
      pull_request: { number: 12, title: "x", user: { id: 501 } },
      review: { id: 5, user: { login: "ari-gh", id: 777 }, state: "approved", html_url: "u", submitted_at: "2026-09-01T12:00:00Z" },
    };
    await deliver("pull_request_review", review);
    await deliver("pull_request_review", review);
    await deliver("pull_request_review", { ...review, review: { ...review.review, id: 6, user: { login: "maya-gh", id: 501 } } });
    const c = await db.contribution.findFirstOrThrow({ where: { githubLogin: "ari-gh" } });
    expect(c.reviews).toBe(1);
    expect(await db.contribution.count({ where: { githubLogin: "maya-gh" } })).toBe(0);
  });

  it("ships a pre-launch project on its first published release, but not on a prerelease", async () => {
    const release = (id: number, prerelease: boolean) => ({
      action: "published",
      repository: repository(),
      release: { id, tag_name: `v0.${id}`, name: null, body: "notes", html_url: "u", draft: false, prerelease, published_at: "2026-09-03T00:00:00Z" },
    });
    await deliver("release", release(1, true));
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).stage).toBe("BUILDING");
    await deliver("release", release(2, false));
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.stage).toBe("SHIPPED");
    expect(p.shippedAt).not.toBeNull();
    expect(await db.release.count({ where: { projectId, isShip: true } })).toBe(1);
  });

  it("records default-branch pushes and schedules a debounced sync", async () => {
    await deliver("push", {
      ref: "refs/heads/feature",
      repository: repository(),
      commits: [{ id: "a", message: "wip" }],
      after: "aaaaaaa1",
    });
    const d = await deliver("push", {
      ref: "refs/heads/main",
      repository: repository(),
      commits: [{ id: "b", message: "Add limiter\n\nlong body" }],
      after: "bbbbbbb2",
      compare: "c",
      sender: { login: "maya-gh" },
      size: 1,
    });
    expect(d.status).toBe("PROCESSED");
    const pushes = await db.activityEvent.findMany({ where: { type: "github.push" } });
    expect(pushes).toHaveLength(1);
    expect((pushes[0]!.payload as { messages: string[] }).messages).toEqual(["Add limiter"]);
    expect(enqueued.some((j) => j.name === "repo.sync")).toBe(true);
  });
});

describe("maintenance", () => {
  it("deletes old webhook deliveries and long-expired sessions, and expires stale invitations", async () => {
    const now = new Date("2026-10-03T00:00:00Z");
    const old = new Date(now.getTime() - 31 * 86400_000);
    await db.webhookDelivery.createMany({ data: [{ id: "old", event: "push", receivedAt: old }, { id: "new", event: "push", receivedAt: now }] });
    const maya = await db.user.findFirstOrThrow({ where: { username: "maya" } });
    await db.session.createMany({
      data: [
        { id: "s-old", userId: maya.id, expiresAt: new Date(now.getTime() - 8 * 86400_000) },
        { id: "s-live", userId: maya.id, expiresAt: new Date(now.getTime() + 86400_000) },
      ],
    });
    const ari = await db.user.create({ data: { username: "ari", displayName: "Ari" } });
    await db.invitation.create({
      data: { projectId, inviterId: maya.id, inviteeId: ari.id, role: "CONTRIBUTOR", tokenHash: "t", expiresAt: new Date(now.getTime() - 1000) },
    });

    const r = await runMaintenance(deps, now);
    expect(r).toEqual({ deliveries: 1, sessions: 1, invitations: 1 });
    expect((await db.webhookDelivery.findMany()).map((d) => d.id)).toEqual(["new"]);
    expect((await db.session.findMany()).map((s) => s.id)).toEqual(["s-live"]);
  });
});

describe("recompute", () => {
  it("derives technologies from language share and manifests, ignoring tiny languages", async () => {
    await recomputeProject(deps, projectId);
    const techs = await db.projectTechnology.findMany({ where: { projectId }, include: { technology: true } });
    const slugs = techs.map((t) => t.technology.slug).sort();
    // Shell is 1% of bytes, under the 2% floor.
    expect(slugs).toEqual(["css", "fastify", "typescript"]);
    expect(techs.find((t) => t.technology.slug === "typescript")!.share).toBeCloseTo(0.9, 2);
  });

  it("links contributions to bld.t accounts by GitHub id", async () => {
    await deliver("pull_request", { action: "opened", repository: repository(), pull_request: pr() });
    await recomputeProject(deps, projectId);
    const c = await db.contribution.findFirstOrThrow({ where: { githubLogin: "maya-gh" } });
    expect(c.userId).not.toBeNull();
  });
});
