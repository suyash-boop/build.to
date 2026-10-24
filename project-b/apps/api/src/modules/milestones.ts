import { CreateMilestoneInput, UpdateMilestoneInput } from "@bldt/contracts";
import { platformEvent, POSITION_STEP, recordActivity } from "@bldt/core";
import type { Db } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize } from "../lib/access.ts";
import { parseDate, toMilestone } from "../lib/dto.ts";
import { notFound } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";
import { scheduleSignalScan } from "./tasks.ts";

const MilestoneParams = ProjectParams.extend({ id: z.uuid() });

export const milestoneRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  app.get("/projects/:owner/:slug/milestones", { schema: { params: ProjectParams } }, async (req) => {
    const { project } = await authorize(db, req.params, req.viewer, "tasks.view");
    return { items: await listMilestones(db, project.id) };
  });

  app.post("/projects/:owner/:slug/milestones", { schema: { params: ProjectParams, body: CreateMilestoneInput } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "milestones.manage");
    const last = await db.milestone.findFirst({ where: { projectId: project.id }, orderBy: { position: "desc" } });
    const m = await db.milestone.create({
      data: {
        projectId: project.id,
        title: req.body.title,
        description: req.body.description ?? null,
        dueOn: parseDate(req.body.dueOn) ?? null,
        status: req.body.status,
        position: (last?.position ?? 0) + POSITION_STEP,
      },
    });
    return reply.status(201).send(toMilestone(m, { total: 0, done: 0 }));
  });

  app.patch("/projects/:owner/:slug/milestones/:id", { schema: { params: MilestoneParams, body: UpdateMilestoneInput } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "milestones.manage");
    const m = await db.milestone.findFirst({ where: { id: req.params.id, projectId: project.id } });
    if (!m) throw notFound("Milestone not found");

    const completing = req.body.status === "DONE" && m.status !== "DONE";
    await db.$transaction(async (tx) => {
      // Only one milestone is active at a time; activating one returns the previous to planned.
      if (req.body.status === "ACTIVE" && m.status !== "ACTIVE") {
        await tx.milestone.updateMany({ where: { projectId: project.id, status: "ACTIVE" }, data: { status: "PLANNED" } });
      }
      await tx.milestone.update({
        where: { id: m.id },
        data: {
          title: req.body.title,
          description: req.body.description,
          dueOn: parseDate(req.body.dueOn),
          status: req.body.status,
          completedAt: completing ? new Date() : req.body.status && req.body.status !== "DONE" ? null : undefined,
        },
      });
      if (completing) {
        // Sequential: a transaction holds one connection, which cannot run queries concurrently.
        const total = await tx.task.count({ where: { milestoneId: m.id, status: { not: "CANCELED" } } });
        const done = await tx.task.count({ where: { milestoneId: m.id, status: "DONE" } });
        await recordActivity(tx, platformEvent(project.id, "milestone.completed", viewer.id, { milestoneId: m.id, title: req.body.title ?? m.title, total, done }));
      }
    });
    void scheduleSignalScan(app, project.id);
    return { ok: true };
  });

  app.delete("/projects/:owner/:slug/milestones/:id", { schema: { params: MilestoneParams } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "milestones.manage");
    const { count } = await db.milestone.deleteMany({ where: { id: req.params.id, projectId: project.id } });
    if (count === 0) throw notFound("Milestone not found");
    return { ok: true };
  });
};

export async function listMilestones(db: Db, projectId: string) {
  const [rows, counts] = await Promise.all([
    db.milestone.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
    db.task.groupBy({ by: ["milestoneId", "status"], where: { projectId, milestoneId: { not: null } }, _count: true }),
  ]);
  return rows.map((m) => {
    const mine = counts.filter((c) => c.milestoneId === m.id);
    const total = mine.filter((c) => c.status !== "CANCELED").reduce((a, c) => a + c._count, 0);
    const done = mine.filter((c) => c.status === "DONE").reduce((a, c) => a + c._count, 0);
    return toMilestone(m, { total, done });
  });
}
