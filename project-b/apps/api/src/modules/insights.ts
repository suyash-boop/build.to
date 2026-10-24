import { taskIdentifier, type AgingItem, type MilestoneForecast, type ProjectInsights, type TaskPriority } from "@bldt/contracts";
import { burnup, distribution, isoDate, percentile, projectMilestoneForecasts, weeklyThroughput } from "@bldt/core";
import { Prisma, type Db } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize } from "../lib/access.ts";
import { toUserRef, userRefSelect } from "../lib/dto.ts";
import { ProjectParams } from "./projects.ts";

const WEEK = 7 * 86_400_000;
const HISTORY_WEEKS = 12;
/** Insights are expensive and change slowly; a minute of staleness is invisible in practice. */
const CACHE_SECONDS = 60;

export const insightsRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, redis } = app.deps;

  app.get(
    "/projects/:owner/:slug/insights",
    { schema: { params: ProjectParams, querystring: z.object({ window: z.enum(["30", "90"]).default("30") }) } },
    async (req, reply) => {
      const { project } = await authorize(db, req.params, req.viewer, "tasks.view");
      const windowDays = Number(req.query.window);
      const key = `insights:v1:${project.id}:${windowDays}`;
      const cached = await redis.get(key);
      if (cached) {
        reply.header("x-cache", "hit");
        return JSON.parse(cached) as ProjectInsights;
      }
      const data = await computeInsights(db, { id: project.id, key: project.key }, windowDays, new Date());
      await redis.set(key, JSON.stringify(data), "EX", CACHE_SECONDS);
      reply.header("x-cache", "miss");
      return data;
    },
  );
};

export async function computeInsights(db: Db, project: { id: string; key: string }, windowDays: number, now: Date): Promise<ProjectInsights> {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const historyStart = new Date(now.getTime() - HISTORY_WEEKS * WEEK);
  const burnStart = new Date(now.getTime() - Math.max(windowDays, 30) * 86_400_000);

  const [completed, createdCount, throughputRows, wipTasks, burnTasks, members] = await Promise.all([
    db.task.findMany({
      where: { projectId: project.id, status: "DONE", completedAt: { gte: since } },
      select: { createdAt: true, startedAt: true, completedAt: true, priority: true, assigneeId: true },
    }),
    db.task.count({ where: { projectId: project.id, createdAt: { gte: since } } }),
    db.task.findMany({
      where: { projectId: project.id, status: "DONE", completedAt: { gte: historyStart } },
      select: { completedAt: true },
    }),
    db.task.findMany({
      where: { projectId: project.id, status: { in: ["IN_PROGRESS", "IN_REVIEW"] } },
      select: { number: true, title: true, status: true, startedAt: true, updatedAt: true, assignee: { select: userRefSelect } },
    }),
    // Tasks that existed at any point in the burn-up range.
    db.task.findMany({
      where: { projectId: project.id, status: { not: "CANCELED" }, OR: [{ completedAt: null }, { completedAt: { gte: burnStart } }] },
      select: { createdAt: true, completedAt: true },
    }),
    db.projectMember.findMany({
      where: { projectId: project.id },
      select: { userId: true, user: { select: { ...userRefSelect, githubAccount: { select: { login: true } } } } },
    }),
  ]);

  // ── Tasks ──
  const cycle = completed.filter((t) => t.startedAt).map((t) => t.completedAt!.getTime() - t.startedAt!.getTime());
  const lead = completed.map((t) => t.completedAt!.getTime() - t.createdAt.getTime());
  const cycleStats = distribution(cycle);
  const history = weeklyThroughput(throughputRows.map((r) => r.completedAt!), now, HISTORY_WEEKS);
  const weekStart = (i: number) => isoDate(new Date(now.getTime() - (HISTORY_WEEKS - i) * WEEK));

  const staleHours = cycleStats.p85;
  const aging: AgingItem[] = wipTasks
    .map((t) => {
      const ageMs = now.getTime() - (t.startedAt ?? t.updatedAt).getTime();
      const ageDays = Math.round((ageMs / 86_400_000) * 10) / 10;
      return {
        number: t.number,
        identifier: taskIdentifier(project.key, t.number),
        title: t.title,
        status: t.status,
        assignee: t.assignee ? toUserRef(t.assignee) : null,
        ageDays,
        stale: staleHours != null && cycleStats.count >= 5 && ageMs / 3_600_000 > staleHours,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays);

  const priorities: TaskPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];
  const byPriority = priorities.map((p) => {
    const rows = completed.filter((t) => t.priority === p && t.startedAt);
    return {
      priority: p,
      completed: completed.filter((t) => t.priority === p).length,
      p50CycleHours: rows.length ? Math.round((percentile(rows.map((r) => (r.completedAt!.getTime() - r.startedAt!.getTime()) / 3_600_000), 0.5) ?? 0) * 10) / 10 : null,
    };
  });

  // ── Pull requests (SQL aggregates over the connected repositories) ──
  const repoIds = (await db.projectRepository.findMany({ where: { projectId: project.id }, select: { repositoryId: true } })).map((r) => r.repositoryId);
  let pullRequests: ProjectInsights["pullRequests"] = null;
  if (repoIds.length) {
    const repos = Prisma.join(repoIds.map((id) => Prisma.sql`${id}::uuid`));
    const [mergeAgg] = await db.$queryRaw<{ merged: bigint; p50: number | null; p85: number | null; size: number | null }[]>`
      SELECT count(*) AS merged,
             percentile_cont(0.5)  WITHIN GROUP (ORDER BY extract(epoch FROM "mergedAt" - "openedAt")) / 3600 AS p50,
             percentile_cont(0.85) WITHIN GROUP (ORDER BY extract(epoch FROM "mergedAt" - "openedAt")) / 3600 AS p85,
             percentile_cont(0.5)  WITHIN GROUP (ORDER BY ("additions" + "deletions")) AS size
      FROM "PullRequest"
      WHERE "repositoryId" IN (${repos}) AND "state" = 'MERGED' AND "mergedAt" >= ${since}`;

    // First non-author review per PR, from the verified GitHub review events of this project.
    const [reviewAgg] = await db.$queryRaw<{ n: bigint; p50: number | null; p85: number | null }[]>`
      WITH first_review AS (
        SELECT e."payload"->>'repo' AS repo, (e."payload"->>'number')::int AS num, min(e."occurredAt") AS at
        FROM "ActivityEvent" e
        WHERE e."projectId" = ${project.id}::uuid AND e."type" = 'github.review'
        GROUP BY 1, 2
      )
      SELECT count(*) AS n,
             percentile_cont(0.5)  WITHIN GROUP (ORDER BY extract(epoch FROM fr.at - pr."openedAt")) / 3600 AS p50,
             percentile_cont(0.85) WITHIN GROUP (ORDER BY extract(epoch FROM fr.at - pr."openedAt")) / 3600 AS p85
      FROM "PullRequest" pr
      JOIN "Repository" r ON r."id" = pr."repositoryId"
      JOIN first_review fr ON fr.repo = r."fullName" AND fr.num = pr."number"
      WHERE pr."repositoryId" IN (${repos}) AND pr."openedAt" >= ${since} AND fr.at >= pr."openedAt"`;

    const [unlinked] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "PullRequest" pr
      WHERE pr."repositoryId" IN (${repos}) AND pr."state" = 'MERGED' AND pr."mergedAt" >= ${since}
        AND NOT EXISTS (SELECT 1 FROM "PullRequestTask" pt JOIN "Task" t ON t."id" = pt."taskId"
                        WHERE pt."pullRequestId" = pr."id" AND t."projectId" = ${project.id}::uuid)`;

    const mergedDates = await db.pullRequest.findMany({
      where: { repositoryId: { in: repoIds }, state: "MERGED", mergedAt: { gte: historyStart } },
      select: { mergedAt: true },
    });
    const perWeek = weeklyThroughput(mergedDates.map((p) => p.mergedAt!), now, HISTORY_WEEKS);
    const r1 = (n: number | null) => (n == null ? null : Math.round(Number(n) * 10) / 10);
    pullRequests = {
      merged: Number(mergeAgg?.merged ?? 0),
      timeToMerge: { count: Number(mergeAgg?.merged ?? 0), p50: r1(mergeAgg?.p50 ?? null), p85: r1(mergeAgg?.p85 ?? null) },
      timeToFirstReview: { count: Number(reviewAgg?.n ?? 0), p50: r1(reviewAgg?.p50 ?? null), p85: r1(reviewAgg?.p85 ?? null) },
      medianSize: mergeAgg?.size == null ? null : Math.round(Number(mergeAgg.size)),
      unlinkedMerged: Number(unlinked?.n ?? 0),
      mergedPerWeek: perWeek.map((count, i) => ({ weekStart: weekStart(i), count })),
    };
  }

  // ── Forecasts (shared with the signals scan) ──
  const { forecasts: raw } = await projectMilestoneForecasts(db, project.id, now);
  const forecasts: MilestoneForecast[] = raw.map((f) => ({
    milestone: { id: f.milestone.id, title: f.milestone.title, dueOn: f.milestone.dueOn ? isoDate(f.milestone.dueOn) : null, status: f.milestone.status as MilestoneForecast["milestone"]["status"] },
    remaining: f.remaining,
    done: f.done,
    p50: f.p50,
    p85: f.p85,
    p95: f.p95,
    onTimeProbability: f.onTimeProbability,
    reason: f.reason,
  }));

  // ── Contributors ──
  const prByLogin = repoIds.length
    ? await db.pullRequest.groupBy({ by: ["authorLogin"], where: { repositoryId: { in: repoIds }, state: "MERGED", mergedAt: { gte: since } }, _count: true })
    : [];
  const reviewsByLogin = await db.activityEvent.groupBy({
    by: ["actorLogin"],
    where: { projectId: project.id, type: "github.review", occurredAt: { gte: since } },
    _count: true,
  });
  const contributors = members
    .map((m) => {
      const login = m.user.githubAccount?.login;
      return {
        user: toUserRef(m.user),
        completed: completed.filter((t) => t.assigneeId === m.userId).length,
        prsMerged: login ? (prByLogin.find((p) => p.authorLogin === login)?._count ?? 0) : 0,
        reviews: login ? (reviewsByLogin.find((r) => r.actorLogin === login)?._count ?? 0) : 0,
      };
    })
    .filter((c) => c.completed + c.prsMerged + c.reviews > 0)
    .sort((a, b) => b.completed + b.prsMerged - (a.completed + a.prsMerged));

  return {
    windowDays,
    generatedAt: now.toISOString(),
    tasks: {
      completed: completed.length,
      created: createdCount,
      cycleTime: { count: cycleStats.count, p50: cycleStats.p50, p85: cycleStats.p85 },
      leadTime: (({ count, p50, p85 }) => ({ count, p50, p85 }))(distribution(lead)),
      throughput: history.map((count, i) => ({ weekStart: weekStart(i), count })),
      wip: wipTasks.length,
      aging,
      byPriority,
    },
    pullRequests,
    burnup: burnup(burnTasks, now, Math.max(windowDays, 30)),
    forecasts,
    contributors,
  };
}
