import { Encrypter } from "@bldt/core";
import { createDb, requireLocalTestDatabase, type Db } from "@bldt/db";
import type { JobClient } from "@bldt/jobs";
import { pino } from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/context.ts";
import { scanAllSignals, scanProjectSignals } from "../src/jobs/signals.ts";

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

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

let projectId: string;
let mayaId: string;
let ariId: string;

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`
    TRUNCATE "Signal","ActivityEvent","Notification","AuditLog","Comment","PullRequestTask","PullRequest",
      "Task","Milestone","Deployment","ProjectRepository","ProjectMember","Project","Repository","User"
    RESTART IDENTITY CASCADE`);
  enqueued.length = 0;
  const maya = await db.user.create({ data: { username: "maya", displayName: "Maya" } });
  const ari = await db.user.create({ data: { username: "ari", displayName: "Ari" } });
  mayaId = maya.id;
  ariId = ari.id;
  const project = await db.project.create({
    data: {
      ownerId: maya.id,
      slug: "relay",
      key: "RELAY",
      name: "Relay",
      stage: "BUILDING",
      visibility: "PUBLIC",
      taskCounter: 1,
      members: { create: [{ userId: maya.id, role: "OWNER" }, { userId: ari.id, role: "CONTRIBUTOR" }] },
      tasks: { create: { number: 1, title: "Token bucket", status: "IN_PROGRESS", position: 1024, creatorId: maya.id, assigneeId: ari.id } },
    },
  });
  projectId = project.id;
});

const signals = () => db.signal.findMany({ where: { projectId }, orderBy: { firstSeenAt: "asc" } });
const notifications = (userId: string) => db.notification.findMany({ where: { recipientId: userId, type: "signal.raised" } });

describe("signal lifecycle", () => {
  it("opens a stalled task once, notifies the assignee once, and stays quiet on repeat scans", async () => {
    expect((await scanProjectSignals(deps, projectId, at(6)))!.opened).toBe(1);
    const [s] = await signals();
    expect(s).toMatchObject({ type: "task.stalled", severity: "WARNING", resolvedAt: null });
    expect(s!.title).toContain("RELAY-1");

    const again = await scanProjectSignals(deps, projectId, at(7));
    expect(again).toMatchObject({ opened: 0, updated: 1, notified: 0 });
    expect(await notifications(ariId)).toHaveLength(1);
    // The owner is not the assignee, so they are not paged for it.
    expect(await notifications(mayaId)).toHaveLength(0);
  });

  it("escalates to critical with a second notification", async () => {
    await scanProjectSignals(deps, projectId, at(6));
    const r = await scanProjectSignals(deps, projectId, at(11));
    expect(r!.notified).toBe(1);
    expect((await signals())[0]!.severity).toBe("CRITICAL");
    expect(await notifications(ariId)).toHaveLength(2);
  });

  it("auto-resolves when the task moves, and reopens as a fresh occurrence", async () => {
    await scanProjectSignals(deps, projectId, at(6));
    await db.task.updateMany({ where: { projectId }, data: { status: "DONE" } });
    expect((await scanProjectSignals(deps, projectId, at(6)))!.resolved).toBe(1);
    expect((await signals())[0]!.resolvedAt).not.toBeNull();

    // Back in progress and idle again: same row, new occurrence, new notification.
    await db.task.updateMany({ where: { projectId }, data: { status: "IN_PROGRESS" } });
    const r = await scanProjectSignals(deps, projectId, at(12));
    expect(r!.opened).toBe(1);
    const rows = await signals();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolvedAt).toBeNull();
    expect(await notifications(ariId)).toHaveLength(2);
  });

  it("keeps snoozed signals updated but silent, including through escalation", async () => {
    await scanProjectSignals(deps, projectId, at(6));
    const [s] = await signals();
    await db.signal.update({ where: { id: s!.id }, data: { snoozedUntil: at(30), snoozedById: mayaId } });

    const r = await scanProjectSignals(deps, projectId, at(11));
    expect(r!.notified).toBe(0);
    expect((await signals())[0]).toMatchObject({ severity: "CRITICAL", snoozedById: mayaId });
    expect(await notifications(ariId)).toHaveLength(1);
  });

  it("does not carry an old snooze into a reopened signal", async () => {
    await scanProjectSignals(deps, projectId, at(6));
    const [s] = await signals();
    await db.signal.update({ where: { id: s!.id }, data: { snoozedUntil: at(60) } });
    await db.task.updateMany({ where: { projectId }, data: { status: "DONE" } });
    await scanProjectSignals(deps, projectId, at(7));
    await db.task.updateMany({ where: { projectId }, data: { status: "IN_PROGRESS" } });

    const r = await scanProjectSignals(deps, projectId, at(13));
    expect(r!.notified).toBe(1);
    expect((await signals())[0]!.snoozedUntil).toBeNull();
  });

  it("respects disabled types and custom thresholds", async () => {
    await db.project.update({ where: { id: projectId }, data: { signalSettings: { stalledDays: 10 } } });
    expect((await scanProjectSignals(deps, projectId, at(6)))!.opened).toBe(0);

    await db.project.update({ where: { id: projectId }, data: { signalSettings: { stalledDays: 2, disabled: ["task.stalled"] } } });
    expect((await scanProjectSignals(deps, projectId, at(6)))!.opened).toBe(0);
    expect(await signals()).toHaveLength(0);
  });

  it("resolves everything when a project is sunset", async () => {
    await scanProjectSignals(deps, projectId, at(6));
    await db.project.update({ where: { id: projectId }, data: { stage: "SUNSET" } });
    expect(await scanProjectSignals(deps, projectId, at(7))).toBeNull();
    expect((await signals()).every((s) => s.resolvedAt)).toBe(true);
  });

  it("flags overdue work and an at-risk milestone from the forecast", async () => {
    const past = new Date(Date.now() - 9 * DAY);
    const ms = await db.milestone.create({ data: { projectId, title: "Beta", dueOn: new Date(Date.now() + 2 * DAY), status: "ACTIVE", position: 1024 } });
    await db.task.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        projectId,
        number: i + 2,
        title: `Slice ${i + 2}`,
        status: "TODO" as const,
        position: 2048 + i,
        creatorId: mayaId,
        milestoneId: ms.id,
        dueOn: i === 0 ? past : null,
      })),
    });
    // One task a week for six weeks: twelve remaining cannot land in two days.
    await db.task.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        projectId,
        number: 20 + i,
        title: `Done ${i}`,
        status: "DONE" as const,
        position: 4096 + i,
        creatorId: mayaId,
        completedAt: new Date(Date.now() - (i * 7 + 2) * DAY),
      })),
    });
    // Without history there is no forecast, and no at-risk guess.
    await scanProjectSignals(deps, projectId);
    const types = (await signals()).map((s) => s.type).sort();
    expect(types).toContain("task.overdue");
    expect(types).toContain("milestone.at_risk");
    // Overdue by 9 days is critical; unassigned work pages the maintainers.
    const overdue = (await signals()).find((s) => s.type === "task.overdue")!;
    expect(overdue.severity).toBe("CRITICAL");
    expect(await notifications(mayaId)).not.toHaveLength(0);
  });

  it("flags unreviewed pull requests only when bld.t saw them from the start", async () => {
    await db.project.update({ where: { id: projectId }, data: { signalSettings: { disabled: ["task.stalled"] } } });
    const repo = await db.repository.create({ data: { githubId: 901n, ownerLogin: "maya", name: "relay", fullName: "maya/relay", htmlUrl: "https://github.com/maya/relay", isPrivate: false } });
    await db.projectRepository.create({ data: { projectId, repositoryId: repo.id, createdAt: new Date(Date.now() - 10 * DAY) } });
    const pr = (number: number, daysAgo: number) =>
      db.pullRequest.create({
        data: { githubId: BigInt(1000 + number), repositoryId: repo.id, number, title: `PR ${number}`, htmlUrl: `https://github.com/maya/relay/pull/${number}`, state: "OPEN", authorLogin: "ari", headRef: `b${number}`, openedAt: new Date(Date.now() - daysAgo * DAY) },
      });
    // Opened before the repository was connected: its reviews were never seen, so no guess.
    await pr(1, 20);
    await pr(2, 3);
    await scanProjectSignals(deps, projectId);
    const rows = await signals();
    expect(rows.map((s) => s.title)).toEqual([expect.stringContaining("#2 has waited")]);
  });

  it("does not resolve signals when a capped list may have left them out", async () => {
    await scanProjectSignals(deps, projectId, at(6));
    await db.task.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ projectId, number: i + 2, title: `Busy ${i}`, status: "IN_PROGRESS" as const, position: 2048 + i, creatorId: mayaId })),
    });
    // The original task now sorts last by age and falls outside the 500 read; its alert stays open.
    await db.task.updateMany({ where: { projectId, number: 1 }, data: { updatedAt: at(1) } });
    await scanProjectSignals(deps, projectId, at(6.5));
    const first = await db.task.findFirstOrThrow({ where: { projectId, number: 1 } });
    const stalled = (await signals()).find((s) => s.dedupeKey === `task.stalled:${first.id}`);
    expect(stalled).toMatchObject({ resolvedAt: null });
  });

  it("queues a scan for every active project", async () => {
    await scanAllSignals(deps);
    expect(enqueued).toEqual([{ name: "signals.scan", data: { projectId } }]);
  });
});
