import type { HomeData } from "@bldt/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { activityInclude, projectCardInclude, taskSummaryInclude, toActivity, toDeployment, toMilestone, toProjectCard, toTaskSummary, toUserRef } from "../lib/dto.ts";
import { requireViewer } from "../plugins/auth.ts";
import { invitationInclude, toInvitation } from "./members.ts";
import { signalInclude, sortSignals, toSignal } from "./signals.ts";

const OPEN = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"] as const;

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  /** Compact list for the sidebar. */
  app.get("/me/projects", async (req) => {
    const viewer = requireViewer(req);
    const rows = await db.projectMember.findMany({
      where: { userId: viewer.id, project: { deletedAt: null } },
      select: {
        role: true,
        showOnProfile: true,
        project: { select: { id: true, name: true, slug: true, key: true, stage: true, visibility: true, updatedAt: true, owner: { select: { username: true } } } },
      },
    });
    return {
      items: rows
        .sort((a, b) => b.project.updatedAt.getTime() - a.project.updatedAt.getTime())
        .map((r) => ({
          id: r.project.id,
          name: r.project.name,
          slug: r.project.slug,
          key: r.project.key,
          stage: r.project.stage,
          ownerUsername: r.project.owner.username,
          role: r.role,
          visibility: r.project.visibility,
          showOnProfile: r.showOnProfile,
        })),
    };
  });

  /** For editors: which of my projects is this git repository connected to? */
  app.get("/me/repo-projects", { schema: { querystring: z.object({ fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }) } }, async (req) => {
    const viewer = requireViewer(req);
    const rows = await db.projectRepository.findMany({
      where: {
        repository: { fullName: { equals: req.query.fullName, mode: "insensitive" } },
        project: { deletedAt: null, members: { some: { userId: viewer.id } } },
      },
      select: { isPrimary: true, project: { select: { name: true, slug: true, key: true, owner: { select: { username: true } } } } },
    });
    return {
      items: rows
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
        .map((r) => ({ name: r.project.name, slug: r.project.slug, key: r.project.key, ownerUsername: r.project.owner.username })),
    };
  });

  app.get("/home", async (req) => {
    const viewer = requireViewer(req);
    const memberships = await db.projectMember.findMany({
      where: { userId: viewer.id, project: { deletedAt: null } },
      include: { project: { include: projectCardInclude } },
    });
    const projectIds = memberships.map((m) => m.projectId);
    const managed = memberships.filter((m) => m.role === "OWNER" || m.role === "MAINTAINER").map((m) => m.projectId);
    const projectRef = (id: string) => {
      const p = memberships.find((m) => m.projectId === id)!.project;
      return { name: p.name, slug: p.slug, ownerUsername: p.owner.username, key: p.key };
    };

    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

    const [openCounts, myOpenCounts, myTasks, invitations, joinRequests, deployments, failedRepos, overdue, activity, signals] = await Promise.all([
      db.task.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, status: { in: [...OPEN] } }, _count: true }),
      db.task.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, assigneeId: viewer.id, status: { in: [...OPEN] } }, _count: true }),
      db.task.findMany({
        where: { assigneeId: viewer.id, status: { in: [...OPEN] }, projectId: { in: projectIds } },
        include: taskSummaryInclude,
        orderBy: [{ priority: "desc" }, { dueOn: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
        take: 50,
      }),
      db.invitation.findMany({
        where: { inviteeId: viewer.id, status: "PENDING", expiresAt: { gt: new Date() }, project: { deletedAt: null } },
        include: invitationInclude,
        orderBy: { createdAt: "desc" },
      }),
      db.joinRequest.findMany({
        where: { projectId: { in: managed }, status: "PENDING" },
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        orderBy: { createdAt: "asc" },
        take: 20,
      }),
      db.deployment.findMany({
        where: { projectId: { in: projectIds } },
        orderBy: { createdAt: "desc" },
        distinct: ["projectId", "environment"],
        take: 100,
      }),
      db.repository.findMany({
        where: { syncStatus: "FAILED", projects: { some: { projectId: { in: managed } } } },
        select: { fullName: true, syncError: true, projects: { where: { projectId: { in: managed } }, select: { projectId: true }, take: 1 } },
      }),
      db.milestone.findMany({
        where: { projectId: { in: managed }, dueOn: { lt: today }, status: { in: ["PLANNED", "ACTIVE"] } },
        orderBy: { dueOn: "asc" },
        take: 10,
      }),
      db.activityEvent.findMany({
        where: { projectId: { in: projectIds } },
        include: activityInclude,
        orderBy: { occurredAt: "desc" },
        take: 30,
      }),
      // Open, unsnoozed signals across the user's projects; INFO stays on the project page.
      db.signal.findMany({
        where: {
          projectId: { in: projectIds },
          resolvedAt: null,
          severity: { in: ["WARNING", "CRITICAL"] },
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
        },
        include: signalInclude,
        take: 50,
      }),
    ]);

    const openBy = new Map(openCounts.map((c) => [c.projectId, c._count]));
    const myOpenBy = new Map(myOpenCounts.map((c) => [c.projectId, c._count]));
    const ACTIVE_STAGES = new Set(["IDEA", "BUILDING", "SHIPPED", "MAINTAINED"]);

    const activeProjects = memberships
      .filter((m) => ACTIVE_STAGES.has(m.project.stage))
      .sort((a, b) => b.project.updatedAt.getTime() - a.project.updatedAt.getTime())
      .slice(0, 12)
      .map((m) => ({
        ...toProjectCard(m.project),
        role: m.role,
        openTasks: openBy.get(m.projectId) ?? 0,
        myOpenTasks: myOpenBy.get(m.projectId) ?? 0,
      }));

    const overdueWithCounts = await Promise.all(
      overdue.map(async (m) => {
        const [total, done] = await Promise.all([
          db.task.count({ where: { milestoneId: m.id, status: { not: "CANCELED" } } }),
          db.task.count({ where: { milestoneId: m.id, status: "DONE" } }),
        ]);
        return { ...toMilestone(m, { total, done }), project: projectRef(m.projectId) };
      }),
    );

    const data: HomeData = {
      activeProjects,
      myTasks: myTasks.map((t) => {
        const p = projectRef(t.projectId);
        return { ...toTaskSummary(t, p.key), project: p };
      }),
      attention: {
        invitations: invitations.map(toInvitation),
        joinRequests: joinRequests.map((r) => ({
          id: r.id,
          user: toUserRef(r.user),
          message: r.message,
          roleWanted: r.roleWanted,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          project: projectRef(r.projectId),
        })),
        failingDeployments: deployments
          .filter((d) => d.state === "FAILURE" || d.state === "ERROR")
          .map((d) => ({ ...toDeployment(d), project: projectRef(d.projectId) })),
        failedSyncs: failedRepos
          .filter((r) => r.projects[0])
          .map((r) => ({ repository: r.fullName, error: r.syncError, project: projectRef(r.projects[0]!.projectId) })),
        overdueMilestones: overdueWithCounts,
      },
      activity: activity.map(toActivity),
      signals: signals.map(toSignal).sort(sortSignals).slice(0, 12),
    };
    return data;
  });
};
