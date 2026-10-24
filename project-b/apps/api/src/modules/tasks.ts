import {
  CreateCommentInput,
  CreateTaskInput,
  STATUS_LABEL,
  taskIdentifier,
  TaskListQuery,
  UpdateTaskInput,
  type TaskDetail,
} from "@bldt/contracts";
import { needsRebalance, notify, platformEvent, POSITION_STEP, positionBetween, recordActivity, statusPatch } from "@bldt/core";
import type { Db, Prisma, TaskStatus } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize } from "../lib/access.ts";
import { activityInclude, isoDate, parseDate, taskSummaryInclude, toActivity, toTaskSummary, toUserRef, userRefSelect } from "../lib/dto.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";

const TaskParams = ProjectParams.extend({ number: z.coerce.number().int().positive() });
const MAX_TASKS = 2000;

export const taskRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  app.get("/projects/:owner/:slug/tasks", { schema: { params: ProjectParams, querystring: TaskListQuery } }, async (req) => {
    const { project } = await authorize(db, req.params, req.viewer, "tasks.view");
    const q = req.query;
    const where: Prisma.TaskWhereInput = { projectId: project.id };
    if (q.status) where.status = { in: q.status };
    if (q.assignee === "me") where.assigneeId = req.viewer!.id;
    else if (q.assignee === "none") where.assigneeId = null;
    else if (q.assignee) where.assigneeId = q.assignee;
    if (q.milestone === "none") where.milestoneId = null;
    else if (q.milestone) where.milestoneId = q.milestone;
    if (q.q) {
      const num = /^(?:[A-Za-z][A-Za-z0-9]*-)?(\d+)$/.exec(q.q)?.[1];
      where.OR = [{ title: { contains: q.q, mode: "insensitive" } }, ...(num ? [{ number: Number(num) }] : [])];
    }

    const tasks = await db.task.findMany({
      where,
      include: taskSummaryInclude,
      orderBy: [{ position: "asc" }],
      take: MAX_TASKS,
    });
    const counts = await commentCounts(db, tasks.map((t) => t.id));
    return { items: tasks.map((t) => toTaskSummary(t, project.key, counts.get(t.id) ?? 0)) };
  });

  app.post("/projects/:owner/:slug/tasks", { schema: { params: ProjectParams, body: CreateTaskInput } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "tasks.create");
    const input = req.body;
    await validateRefs(db, project.id, input.assigneeId, input.milestoneId);

    const task = await db.$transaction(async (tx) => {
      const { taskCounter } = await tx.project.update({
        where: { id: project.id },
        data: { taskCounter: { increment: 1 } },
        select: { taskCounter: true },
      });
      const last = await tx.task.findFirst({
        where: { projectId: project.id, status: input.status },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const now = new Date();
      const created = await tx.task.create({
        data: {
          projectId: project.id,
          number: taskCounter,
          title: input.title,
          description: input.description ?? null,
          status: input.status,
          priority: input.priority,
          position: (last?.position ?? 0) + POSITION_STEP,
          assigneeId: input.assigneeId ?? null,
          milestoneId: input.milestoneId ?? null,
          dueOn: parseDate(input.dueOn) ?? null,
          creatorId: viewer.id,
          startedAt: input.status === "IN_PROGRESS" || input.status === "IN_REVIEW" ? now : null,
          completedAt: input.status === "DONE" || input.status === "CANCELED" ? now : null,
        },
        include: taskSummaryInclude,
      });
      await recordActivity(
        tx,
        platformEvent(project.id, "task.created", viewer.id, {
          taskId: created.id,
          identifier: taskIdentifier(project.key, created.number),
          title: created.title,
        }),
      );
      if (created.assigneeId) await notifyAssigned(tx, created.assigneeId, viewer.id, project, created);
      return created;
    });
    void scheduleSignalScan(app, project.id);
    return reply.status(201).send(toTaskSummary(task, project.key));
  });

  app.get("/projects/:owner/:slug/tasks/:number", { schema: { params: TaskParams } }, async (req) => {
    const { project } = await authorize(db, req.params, req.viewer, "tasks.view");
    const task = await db.task.findUnique({
      where: { projectId_number: { projectId: project.id, number: req.params.number } },
      include: {
        ...taskSummaryInclude,
        creator: { select: userRefSelect },
        pullRequests: { include: { pullRequest: { include: { repository: { select: { fullName: true } } } } } },
      },
    });
    if (!task) throw notFound("Task not found");

    const [comments, history] = await Promise.all([
      db.comment.findMany({
        where: { subjectType: "TASK", subjectId: task.id, deletedAt: null },
        include: { author: { select: userRefSelect } },
        orderBy: { createdAt: "asc" },
      }),
      // Uses the partial expression index ActivityEvent_projectId_taskId_idx.
      db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ActivityEvent"
        WHERE "projectId" = ${project.id}::uuid AND "payload" ? 'taskId' AND ("payload"->>'taskId') = ${task.id}
        ORDER BY "occurredAt" ASC LIMIT 100`.then((ids) =>
        ids.length ? db.activityEvent.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: activityInclude, orderBy: { occurredAt: "asc" } }) : [],
      ),
    ]);

    const detail: TaskDetail = {
      ...toTaskSummary(task, project.key, comments.length),
      description: task.description,
      creator: toUserRef(task.creator),
      startedAt: task.startedAt?.toISOString() ?? null,
      pullRequests: task.pullRequests.map(({ pullRequest: pr, closes }) => ({
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.htmlUrl,
        state: pr.state,
        isDraft: pr.isDraft,
        repoFullName: pr.repository.fullName,
        authorLogin: pr.authorLogin,
        closes,
      })),
      comments: comments.map((c) => ({
        id: c.id,
        author: toUserRef(c.author),
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        editedAt: c.editedAt?.toISOString() ?? null,
      })),
      history: history.map(toActivity),
    };
    return detail;
  });

  app.patch("/projects/:owner/:slug/tasks/:number", { schema: { params: TaskParams, body: UpdateTaskInput } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "tasks.update");
    const input = req.body;
    const task = await db.task.findUnique({ where: { projectId_number: { projectId: project.id, number: req.params.number } } });
    if (!task) throw notFound("Task not found");
    await validateRefs(db, project.id, input.assigneeId, input.milestoneId);

    const targetStatus = input.status ?? task.status;
    let position: number | undefined;
    if (input.move) {
      position = await placeBetween(db, project.id, targetStatus, input.move.beforeId, input.move.afterId, task.id);
    } else if (input.status && input.status !== task.status) {
      const last = await db.task.findFirst({
        where: { projectId: project.id, status: targetStatus },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      position = (last?.position ?? 0) + POSITION_STEP;
    }

    const updated = await db.$transaction(async (tx) => {
      const data: Prisma.TaskUncheckedUpdateInput = {
        title: input.title,
        description: input.description,
        priority: input.priority,
        assigneeId: input.assigneeId,
        milestoneId: input.milestoneId,
        dueOn: parseDate(input.dueOn),
        position,
        ...(input.status && input.status !== task.status ? statusPatch(task, input.status) : {}),
      };
      const row = await tx.task.update({ where: { id: task.id }, data, include: taskSummaryInclude });

      const base = { taskId: task.id, identifier: taskIdentifier(project.key, task.number), title: row.title };
      if (input.status && input.status !== task.status) {
        await recordActivity(
          tx,
          platformEvent(project.id, input.status === "DONE" ? "task.completed" : "task.status_changed", viewer.id, {
            ...base,
            from: task.status,
            to: input.status,
          }),
        );
      }
      if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId && input.assigneeId) {
        await notifyAssigned(tx, input.assigneeId, viewer.id, project, row);
      }
      if (input.dueOn !== undefined && isoDate(task.dueOn) !== input.dueOn) {
        await recordActivity(tx, platformEvent(project.id, "task.due_changed", viewer.id, { ...base, dueOn: input.dueOn }));
      }
      return row;
    });

    if (position !== undefined) await rebalanceIfNeeded(db, project.id, targetStatus, updated.id, updated.position);
    if (input.status || input.assigneeId !== undefined || input.dueOn !== undefined || input.milestoneId !== undefined) void scheduleSignalScan(app, project.id);
    return toTaskSummary(updated, project.key);
  });

  app.delete("/projects/:owner/:slug/tasks/:number", { schema: { params: TaskParams } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "tasks.delete");
    const task = await db.task.findUnique({ where: { projectId_number: { projectId: project.id, number: req.params.number } } });
    if (!task) throw notFound("Task not found");
    await db.$transaction([
      db.comment.deleteMany({ where: { subjectType: "TASK", subjectId: task.id } }),
      db.task.delete({ where: { id: task.id } }),
    ]);
    return { ok: true };
  });

  // ── Comments ────────────────────────────────────────────────

  app.post(
    "/projects/:owner/:slug/tasks/:number/comments",
    { schema: { params: TaskParams, body: CreateCommentInput }, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "comments.create");
      const task = await db.task.findUnique({ where: { projectId_number: { projectId: project.id, number: req.params.number } } });
      if (!task) throw notFound("Task not found");

      const comment = await db.$transaction(async (tx) => {
        const c = await tx.comment.create({
          data: { projectId: project.id, subjectType: "TASK", subjectId: task.id, authorId: viewer.id, body: req.body.body },
          include: { author: { select: userRefSelect } },
        });
        // Notify the assignee, the creator, and @mentioned members.
        const mentioned = await mentionedMembers(tx, project.id, req.body.body);
        const recipients = [task.assigneeId, task.creatorId, ...mentioned].filter((x): x is string => Boolean(x));
        await notify(tx, recipients, "task.commented", {
          projectName: project.name,
          projectSlug: project.slug,
          ownerUsername: project.owner.username,
          identifier: taskIdentifier(project.key, task.number),
          number: task.number,
          title: task.title,
          author: viewer.username,
          excerpt: req.body.body.slice(0, 160),
        }, { projectId: project.id, exclude: viewer.id, membersOnly: true });
        return c;
      });
      return reply.status(201).send({
        id: comment.id,
        author: toUserRef(comment.author),
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
        editedAt: null,
      });
    },
  );

  app.patch(
    "/projects/:owner/:slug/comments/:id",
    { schema: { params: ProjectParams.extend({ id: z.uuid() }), body: CreateCommentInput } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "comments.create");
      const c = await db.comment.findFirst({ where: { id: req.params.id, projectId: project.id, deletedAt: null } });
      if (!c) throw notFound("Comment not found");
      if (c.authorId !== viewer.id) throw forbidden("You can only edit your own comments");
      await db.comment.update({ where: { id: c.id }, data: { body: req.body.body, editedAt: new Date() } });
      return { ok: true };
    },
  );

  app.delete(
    "/projects/:owner/:slug/comments/:id",
    { schema: { params: ProjectParams.extend({ id: z.uuid() }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project, role } = await authorize(db, req.params, viewer, "comments.create");
      const c = await db.comment.findFirst({ where: { id: req.params.id, projectId: project.id, deletedAt: null } });
      if (!c) throw notFound("Comment not found");
      const isManager = role === "OWNER" || role === "MAINTAINER";
      if (c.authorId !== viewer.id && !isManager) throw forbidden();
      await db.comment.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
      return { ok: true };
    },
  );
};

// ── helpers ──────────────────────────────────────────────────

async function commentCounts(db: Db, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, number>();
  const rows = await db.comment.groupBy({
    by: ["subjectId"],
    where: { subjectType: "TASK", subjectId: { in: taskIds }, deletedAt: null },
    _count: true,
  });
  return new Map(rows.map((r) => [r.subjectId, r._count]));
}

async function validateRefs(db: Db, projectId: string, assigneeId?: string | null, milestoneId?: string | null) {
  if (assigneeId) {
    const m = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } });
    if (!m || m.role === "VIEWER") throw badRequest("Assignee must be a project member with contributor access");
  }
  if (milestoneId) {
    const ms = await db.milestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!ms) throw badRequest("Milestone does not belong to this project");
  }
}

async function placeBetween(db: Db, projectId: string, status: TaskStatus, beforeId: string | null, afterId: string | null, selfId: string) {
  const ids = [beforeId, afterId].filter((x): x is string => Boolean(x) && x !== selfId);
  const neighbours = ids.length
    ? await db.task.findMany({ where: { id: { in: ids }, projectId, status }, select: { id: true, position: true } })
    : [];
  if (neighbours.length !== ids.length) throw badRequest("Move target is not in the destination column");
  const pos = (id: string | null) => (id ? (neighbours.find((n) => n.id === id)?.position ?? null) : null);

  if (!beforeId && !afterId) {
    const last = await db.task.findFirst({ where: { projectId, status, id: { not: selfId } }, orderBy: { position: "desc" } });
    return (last?.position ?? 0) + POSITION_STEP;
  }
  return positionBetween(pos(beforeId), pos(afterId));
}

/** Renumber a column when fractional positions get too close to represent. Rare. */
async function rebalanceIfNeeded(db: Db, projectId: string, status: TaskStatus, taskId: string, position: number) {
  const [before, after] = await Promise.all([
    db.task.findFirst({ where: { projectId, status, position: { lt: position }, id: { not: taskId } }, orderBy: { position: "desc" } }),
    db.task.findFirst({ where: { projectId, status, position: { gt: position }, id: { not: taskId } }, orderBy: { position: "asc" } }),
  ]);
  if (!needsRebalance(before?.position ?? null, after?.position ?? null, position)) return;
  const all = await db.task.findMany({ where: { projectId, status }, orderBy: { position: "asc" }, select: { id: true } });
  await db.$transaction(all.map((t, i) => db.task.update({ where: { id: t.id }, data: { position: (i + 1) * POSITION_STEP } })));
}

async function notifyAssigned(
  tx: Prisma.TransactionClient,
  assigneeId: string,
  actorId: string,
  project: { id: string; key: string; name: string; slug: string; owner: { username: string } },
  task: { number: number; title: string; status: TaskStatus },
) {
  await notify(tx, [assigneeId], "task.assigned", {
    projectName: project.name,
    projectSlug: project.slug,
    ownerUsername: project.owner.username,
    identifier: taskIdentifier(project.key, task.number),
    number: task.number,
    title: task.title,
    status: STATUS_LABEL[task.status],
  }, { projectId: project.id, exclude: actorId, membersOnly: true });
}

async function mentionedMembers(tx: Prisma.TransactionClient, projectId: string, body: string): Promise<string[]> {
  const names = [...new Set([...body.matchAll(/(?:^|\s)@([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\b/gi)].map((m) => m[1]!.toLowerCase()))];
  if (names.length === 0) return [];
  const rows = await tx.projectMember.findMany({
    where: { projectId, user: { username: { in: names.slice(0, 20) } } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Task changes can open or resolve signals; rescan shortly after, coalescing bursts. */
export async function scheduleSignalScan(app: { deps: { jobs: { enqueue: (n: "signals.scan", d: { projectId: string }, o: { dedupeId: string; delayMs: number }) => Promise<unknown> } }; log: { warn: (o: object, m: string) => void } }, projectId: string) {
  try {
    await app.deps.jobs.enqueue("signals.scan", { projectId }, { dedupeId: projectId, delayMs: 15_000 });
  } catch (err) {
    // A failed enqueue must never fail the user's edit; the 30-minute sweep catches up.
    app.log.warn({ err, projectId }, "could not schedule signals scan");
  }
}
