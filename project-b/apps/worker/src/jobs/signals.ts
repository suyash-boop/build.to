import { detectSignals, projectMilestoneForecasts, reconcileSignals, resolveSettings, type SignalSnapshot, type SignalType } from "@bldt/core";
import type { WorkerDeps } from "../context.ts";

const DAY = 86_400_000;
const LIMITS = { inProgress: 500, overdue: 200, openPrs: 200, merged: 50, reviews: 5000 } as const;

/** Gather everything detectors need for one project. Reads only; all queries are bounded. */
export async function gatherSnapshot(deps: WorkerDeps, projectId: string, now = new Date()): Promise<{ snapshot: SignalSnapshot; settings: unknown; project: { name: string; slug: string; ownerUsername: string }; partial: SignalType[] } | null> {
  const { db } = deps;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, key: true, name: true, slug: true, deletedAt: true, stage: true, signalSettings: true, owner: { select: { username: true } } },
  });
  if (!project || project.deletedAt || project.stage === "SUNSET") return null;

  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const links = await db.projectRepository.findMany({ where: { projectId }, select: { repositoryId: true, createdAt: true } });
  const repoIds = links.map((r) => r.repositoryId);

  const [members, inProgress, overdue, deploys, openPrs, mergedRecent, { forecasts }] = await Promise.all([
    db.projectMember.findMany({ where: { projectId }, select: { userId: true, role: true, user: { select: { displayName: true } } } }),
    db.task.findMany({
      where: { projectId, status: { in: ["IN_PROGRESS", "IN_REVIEW"] } },
      select: {
        id: true,
        number: true,
        title: true,
        assigneeId: true,
        updatedAt: true,
        startedAt: true,
        pullRequests: { select: { pullRequest: { select: { updatedAt: true } } } },
      },
      // Oldest movement first, so a capped list keeps the tasks most likely to be stalled.
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: LIMITS.inProgress,
    }),
    db.task.findMany({
      where: { projectId, dueOn: { lt: today }, status: { notIn: ["DONE", "CANCELED"] } },
      select: { id: true, number: true, title: true, assigneeId: true, dueOn: true },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      take: LIMITS.overdue,
    }),
    db.deployment.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, distinct: ["environment"], take: 20 }),
    repoIds.length
      ? db.pullRequest.findMany({
          where: { repositoryId: { in: repoIds }, state: "OPEN", isDraft: false },
          select: { id: true, number: true, title: true, htmlUrl: true, authorLogin: true, openedAt: true, repositoryId: true, repository: { select: { fullName: true } }, tasks: { select: { task: { select: { assigneeId: true, projectId: true } } } } },
          orderBy: [{ openedAt: "asc" }, { id: "asc" }],
          take: LIMITS.openPrs,
        })
      : [],
    repoIds.length
      ? db.pullRequest.findMany({
          where: { repositoryId: { in: repoIds }, state: "MERGED", mergedAt: { gte: new Date(now.getTime() - 14 * DAY) }, tasks: { none: { task: { projectId } } } },
          select: { number: true, title: true, htmlUrl: true },
          orderBy: [{ mergedAt: "desc" }, { id: "asc" }],
          take: LIMITS.merged,
        })
      : [],
    projectMilestoneForecasts(db, projectId, now),
  ]);

  // Last movement includes comments, not just field edits.
  const lastComments = inProgress.length
    ? await db.comment.groupBy({
        by: ["subjectId"],
        where: { subjectType: "TASK", subjectId: { in: inProgress.map((t) => t.id) }, deletedAt: null },
        _max: { createdAt: true },
      })
    : [];
  const commentAt = new Map(lastComments.map((c) => [c.subjectId, c._max.createdAt]));

  // Which open PRs already have a review recorded.
  const reviewed = new Set(
    openPrs.length
      ? (
          await db.activityEvent.findMany({
            where: { projectId, type: "github.review", occurredAt: { gte: new Date(now.getTime() - 120 * DAY) } },
            select: { payload: true },
            orderBy: { occurredAt: "desc" },
            take: LIMITS.reviews,
          })
        ).map((e) => {
          const p = e.payload as { repo?: string; number?: number };
          return `${p.repo}#${p.number}`;
        })
      : [],
  );

  // Reviews are only recorded from the moment a repository is connected, so a pull request opened
  // before then may well have been reviewed already. Only flag the ones bld.t watched from the start.
  const connectedAt = new Map(links.map((l) => [l.repositoryId, l.createdAt]));

  const snapshot: SignalSnapshot = {
    now,
    project: { id: project.id, key: project.key, managerIds: members.filter((m) => m.role === "OWNER" || m.role === "MAINTAINER").map((m) => m.userId) },
    members: members.map((m) => ({ id: m.userId, name: m.user.displayName })),
    inProgress: inProgress.map((t) => {
      const times = [t.updatedAt, t.startedAt, commentAt.get(t.id), ...t.pullRequests.map((p) => p.pullRequest.updatedAt)].filter((d): d is Date => d instanceof Date);
      return { id: t.id, number: t.number, title: t.title, assigneeId: t.assigneeId, lastMovedAt: new Date(Math.max(...times.map((d) => d.getTime()))) };
    }),
    overdue: overdue.map((t) => ({ id: t.id, number: t.number, title: t.title, assigneeId: t.assigneeId, dueOn: t.dueOn! })),
    waitingPrs: openPrs
      .filter((p) => p.openedAt >= connectedAt.get(p.repositoryId)! && !reviewed.has(`${p.repository.fullName}#${p.number}`))
      .map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        url: p.htmlUrl,
        repo: p.repository.fullName,
        author: p.authorLogin,
        readySince: p.openedAt,
        linkedAssigneeIds: p.tasks.filter((x) => x.task.projectId === projectId && x.task.assigneeId).map((x) => x.task.assigneeId!),
      })),
    milestones: forecasts.map((f) => ({
      id: f.milestone.id,
      title: f.milestone.title,
      dueOn: f.milestone.dueOn,
      remaining: f.remaining,
      onTimeProbability: f.onTimeProbability,
      p85: f.p85,
    })),
    failingDeploys: deploys.filter((d) => d.state === "FAILURE" || d.state === "ERROR").map((d) => ({ environment: d.environment, sha: d.sha, url: d.url, since: d.updatedAt })),
    unlinkedMergedPrs: mergedRecent.map((p) => ({ number: p.number, title: p.title, url: p.htmlUrl })),
  };
  // A list cut at its limit is not the whole picture: its open signals must not be resolved for
  // falling outside it.
  const partial: SignalType[] = [];
  if (inProgress.length === LIMITS.inProgress) partial.push("task.stalled", "wip.overload");
  if (overdue.length === LIMITS.overdue) partial.push("task.overdue");
  if (openPrs.length === LIMITS.openPrs) partial.push("review.waiting");
  return { snapshot, settings: project.signalSettings, project: { name: project.name, slug: project.slug, ownerUsername: project.owner.username }, partial };
}

export async function scanProjectSignals(deps: WorkerDeps, projectId: string, now = new Date()) {
  const gathered = await gatherSnapshot(deps, projectId, now);
  if (!gathered) {
    // Deleted or sunset projects should not keep stale alerts open.
    await deps.db.signal.updateMany({ where: { projectId, resolvedAt: null }, data: { resolvedAt: now } });
    return null;
  }
  const candidates = detectSignals(gathered.snapshot, resolveSettings(gathered.settings));
  const result = await reconcileSignals(deps.db, projectId, gathered.project, candidates, now, { keepUnseen: gathered.partial });
  if (result.opened || result.resolved) deps.log.info({ projectId, ...result }, "signals reconciled");
  return result;
}

/** Scheduled: scan every project with recent activity or open signals. */
export async function scanAllSignals(deps: WorkerDeps) {
  const since = new Date(Date.now() - 60 * DAY);
  const projects = await deps.db.project.findMany({
    where: { deletedAt: null, OR: [{ updatedAt: { gte: since } }, { signals: { some: { resolvedAt: null } } }, { tasks: { some: { status: { in: ["IN_PROGRESS", "IN_REVIEW"] } } } }] },
    select: { id: true },
    take: 5000,
  });
  for (const p of projects) await deps.jobs.enqueue("signals.scan", { projectId: p.id }, { dedupeId: p.id });
  deps.log.info({ count: projects.length }, "queued signal scans");
}
