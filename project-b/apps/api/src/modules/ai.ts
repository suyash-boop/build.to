import { AI_MODEL, AiRefusedError, AiUnavailableError, type BriefInput, type ProjectBrief } from "@bldt/ai";
import { taskIdentifier, type ProjectBriefItem } from "@bldt/contracts";
import type { Db, Prisma } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { authorize } from "../lib/access.ts";
import { isoDate, toUserRef, userRefSelect } from "../lib/dto.ts";
import { AppError, conflict, notFound } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";

/** One regeneration per project per window keeps cost predictable and stops accidental loops. */
const BRIEF_COOLDOWN_MS = 10 * 60 * 1000;

const aiDisabled = () => new AppError(404, "ai_disabled", "AI features are not enabled on this server");

function mapAiError(err: unknown): never {
  if (err instanceof AiRefusedError) throw new AppError(422, "ai_refused", err.message);
  if (err instanceof AiUnavailableError) throw new AppError(503, "ai_unavailable", err.message);
  throw err;
}

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  /** Latest stored brief. Members only: briefs mention task titles and assignees. */
  app.get("/projects/:owner/:slug/brief", { schema: { params: ProjectParams } }, async (req) => {
    const { project } = await authorize(db, req.params, req.viewer, "tasks.view");
    const row = await db.projectBrief.findUnique({ where: { projectId: project.id } });
    if (!row) return { brief: null, enabled: app.deps.ai !== null };
    const by = row.generatedById ? await db.user.findUnique({ where: { id: row.generatedById }, select: userRefSelect }) : null;
    const content = row.content as unknown as ProjectBrief;
    const brief: ProjectBriefItem = { ...content, generatedAt: row.generatedAt.toISOString(), generatedBy: by ? toUserRef(by) : null, model: row.model };
    return { brief, enabled: app.deps.ai !== null };
  });

  app.post(
    "/projects/:owner/:slug/brief",
    { schema: { params: ProjectParams }, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "tasks.create");
      const ai = app.deps.ai;
      if (!ai) throw aiDisabled();

      const existing = await db.projectBrief.findUnique({ where: { projectId: project.id }, select: { generatedAt: true } });
      if (existing && Date.now() - existing.generatedAt.getTime() < BRIEF_COOLDOWN_MS) {
        throw conflict("A brief was generated in the last 10 minutes. Try again shortly.");
      }

      const input = await briefInput(db, project.id);
      let brief: ProjectBrief;
      try {
        brief = await ai.projectBrief(input);
      } catch (err) {
        mapAiError(err);
      }
      const row = await db.projectBrief.upsert({
        where: { projectId: project.id },
        create: { projectId: project.id, content: brief as unknown as Prisma.InputJsonValue, model: AI_MODEL, generatedById: viewer.id },
        update: { content: brief as unknown as Prisma.InputJsonValue, model: AI_MODEL, generatedById: viewer.id, generatedAt: new Date() },
      });
      const result: ProjectBriefItem = { ...brief, generatedAt: row.generatedAt.toISOString(), generatedBy: toUserRef(viewer), model: AI_MODEL };
      return { brief: result, enabled: true };
    },
  );

  /** Draft release notes from merged PRs and completed tasks since the last release. Nothing is saved. */
  app.post(
    "/projects/:owner/:slug/releases/draft",
    { schema: { params: ProjectParams }, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "project.ship");
      const ai = app.deps.ai;
      if (!ai) throw aiDisabled();

      const last = await db.release.findFirst({ where: { projectId: project.id }, orderBy: { shippedAt: "desc" }, select: { shippedAt: true, version: true, title: true } });
      const since = last?.shippedAt ?? project.createdAt;
      const [prs, tasks] = await Promise.all([
        db.pullRequest.findMany({
          where: { state: "MERGED", mergedAt: { gt: since }, repository: { projects: { some: { projectId: project.id } } } },
          select: { number: true, title: true, authorLogin: true },
          orderBy: { mergedAt: "asc" },
          take: 150,
        }),
        db.task.findMany({
          where: { projectId: project.id, status: "DONE", completedAt: { gt: since } },
          select: { number: true, title: true },
          orderBy: { completedAt: "asc" },
          take: 150,
        }),
      ]);
      if (prs.length === 0 && tasks.length === 0) throw notFound("Nothing has been merged or completed since the last release");

      try {
        const draft = await ai.releaseNotes({
          project: { name: project.name, key: project.key },
          sinceLabel: last ? `since ${last.version ?? last.title} (${isoDate(last.shippedAt)})` : "since the project started",
          mergedPrs: prs.map((p) => ({ number: p.number, title: p.title, author: p.authorLogin })),
          completedTasks: tasks.map((t) => ({ id: taskIdentifier(project.key, t.number), title: t.title })),
        });
        return { ...draft, basedOn: { pullRequests: prs.length, tasks: tasks.length, since: since.toISOString() } };
      } catch (err) {
        mapAiError(err);
      }
    },
  );
};

async function briefInput(db: Db, projectId: string): Promise<BriefInput> {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { repositories: { where: { isPrimary: true }, include: { repository: { select: { readme: true } } } } },
  });
  const twoWeeks = new Date(Date.now() - 14 * 86400_000);
  const repoFilter = { repository: { projects: { some: { projectId } } } };
  const [milestones, open, done, merged, openPrs, releases] = await Promise.all([
    db.milestone.findMany({ where: { projectId, status: { in: ["ACTIVE", "PLANNED"] } }, orderBy: { position: "asc" }, take: 5 }),
    db.task.findMany({
      where: { projectId, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } },
      include: { assignee: { select: { displayName: true } } },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 40,
    }),
    db.task.findMany({ where: { projectId, status: "DONE", completedAt: { gt: twoWeeks } }, orderBy: { completedAt: "desc" }, take: 30 }),
    db.pullRequest.findMany({ where: { ...repoFilter, state: "MERGED", mergedAt: { gt: twoWeeks } }, orderBy: { mergedAt: "desc" }, take: 30 }),
    db.pullRequest.findMany({ where: { ...repoFilter, state: "OPEN" }, orderBy: { openedAt: "desc" }, take: 20 }),
    db.release.findMany({ where: { projectId }, orderBy: { shippedAt: "desc" }, take: 3 }),
  ]);
  const counts = await db.task.groupBy({
    by: ["milestoneId", "status"],
    where: { milestoneId: { in: milestones.map((m) => m.id) } },
    _count: true,
  });
  const tally = (id: string, statuses: string[]) => counts.filter((c) => c.milestoneId === id && statuses.includes(c.status)).reduce((a, c) => a + c._count, 0);

  return {
    project: {
      name: p.name,
      key: p.key,
      tagline: p.tagline,
      stage: p.stage,
      createdAt: isoDate(p.createdAt)!,
      shippedAt: isoDate(p.shippedAt),
    },
    readme: p.description ?? p.repositories[0]?.repository.readme ?? null,
    milestones: milestones.map((m) => ({
      title: m.title,
      status: m.status,
      dueOn: isoDate(m.dueOn),
      done: tally(m.id, ["DONE"]),
      total: tally(m.id, ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]),
    })),
    openTasks: open.map((t) => ({
      id: taskIdentifier(p.key, t.number),
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignee: t.assignee?.displayName ?? null,
      dueOn: isoDate(t.dueOn),
    })),
    recentlyDone: done.map((t) => ({ id: taskIdentifier(p.key, t.number), title: t.title, completedAt: isoDate(t.completedAt)! })),
    mergedPrs: merged.map((r) => ({ number: r.number, title: r.title, author: r.authorLogin, mergedAt: isoDate(r.mergedAt)! })),
    openPrs: openPrs.map((r) => ({ number: r.number, title: r.title, author: r.authorLogin, openedAt: isoDate(r.openedAt)!, draft: r.isDraft })),
    releases: releases.map((r) => ({ title: r.title, version: r.version, shippedAt: isoDate(r.shippedAt)! })),
    today: new Date().toISOString().slice(0, 10),
  };
}
