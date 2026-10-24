import type { TaskStatus } from "@bldt/contracts";
import { taskIdentifier } from "@bldt/contracts";
import type { Db, Prisma } from "@bldt/db";
import { parseTaskReferences } from "@bldt/github";
import { recordActivity } from "./activity.ts";

type Tx = Db | Prisma.TransactionClient;

/** Timestamps that follow a status change. Keeps startedAt/completedAt honest for cycle-time metrics. */
export function statusPatch(prev: { status: TaskStatus; startedAt: Date | null }, next: TaskStatus, now = new Date()) {
  const patch: { status: TaskStatus; startedAt?: Date | null; completedAt?: Date | null } = { status: next };
  const active = next === "IN_PROGRESS" || next === "IN_REVIEW";
  if (active && !prev.startedAt) patch.startedAt = now;
  if (next === "DONE" || next === "CANCELED") patch.completedAt = now;
  else if (prev.status === "DONE" || prev.status === "CANCELED") patch.completedAt = null;
  if (next === "BACKLOG" || next === "TODO") patch.startedAt = null;
  return patch;
}

const RANK: Record<TaskStatus, number> = { BACKLOG: 0, TODO: 1, IN_PROGRESS: 2, IN_REVIEW: 3, DONE: 4, CANCELED: 4 };

/** Status a linked PR implies for a task, or null if the PR should not move it. Never moves work backwards. */
export function impliedStatus(
  current: TaskStatus,
  pr: { state: "OPEN" | "CLOSED" | "MERGED"; isDraft: boolean },
  closes: boolean,
): TaskStatus | null {
  let target: TaskStatus | null = null;
  if (pr.state === "MERGED" && closes) target = "DONE";
  else if (pr.state === "OPEN" && !pr.isDraft) target = "IN_REVIEW";
  else if (pr.state === "OPEN" && pr.isDraft) target = "IN_PROGRESS";
  if (!target || RANK[target] <= RANK[current]) return null;
  return target;
}

/**
 * Link a mirrored pull request to tasks it references in projects connected to its repository,
 * and advance those tasks. Safe to call repeatedly. PR bodies are not stored, so callers pass
 * the body they received from GitHub.
 */
export async function linkPullRequest(db: Db, pullRequestId: string, body: string | null) {
  const pr = await db.pullRequest.findUnique({
    where: { id: pullRequestId },
    include: {
      repository: { include: { projects: { include: { project: { select: { id: true, key: true, deletedAt: true } } } } } },
    },
  });
  if (!pr) return;
  const projects = pr.repository.projects.map((p) => p.project).filter((p) => !p.deletedAt);
  if (projects.length === 0) return;
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const refs = parseTaskReferences({ title: pr.title, body, branch: pr.headRef }, byKey.keys());
  await applyRefs(db, pr, refs, byKey);
}

async function applyRefs(
  db: Db,
  pr: { id: string; number: number; title: string; htmlUrl: string; state: "OPEN" | "CLOSED" | "MERGED"; isDraft: boolean; authorLogin: string; repository: { fullName: string } },
  refs: ReturnType<typeof parseTaskReferences>,
  byKey: Map<string, { id: string; key: string }>,
) {
  for (const ref of refs) {
    const project = byKey.get(ref.key);
    if (!project) continue;
    const task = await db.task.findUnique({ where: { projectId_number: { projectId: project.id, number: ref.number } } });
    if (!task) continue;

    await db.pullRequestTask.upsert({
      where: { pullRequestId_taskId: { pullRequestId: pr.id, taskId: task.id } },
      create: { pullRequestId: pr.id, taskId: task.id, closes: ref.closes },
      update: { closes: ref.closes },
    });

    const next = impliedStatus(task.status, pr, ref.closes);
    if (!next) continue;

    await db.task.update({ where: { id: task.id }, data: statusPatch(task, next) });
    await recordActivity(db, {
      projectId: project.id,
      type: next === "DONE" ? "task.completed" : "task.status_changed",
      source: "GITHUB",
      externalId: `pr-link:${pr.id}:${task.id}:${next}`,
      trust: "CONNECTED",
      actorLogin: pr.authorLogin,
      payload: {
        taskId: task.id,
        identifier: taskIdentifier(project.key, task.number),
        title: task.title,
        from: task.status,
        to: next,
        via: { kind: "pull_request", number: pr.number, url: pr.htmlUrl, repo: pr.repository.fullName },
      },
    });
  }
}
