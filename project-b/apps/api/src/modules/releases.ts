import { can, ShipInput, taskIdentifier, type ChangelogDto } from "@bldt/contracts";
import { buildChangelog, changelogMarkdown, recordRelease } from "@bldt/core";
import { z } from "zod";
import { notFound } from "../lib/errors.ts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { authorize } from "../lib/access.ts";
import { toDeployment, toRelease, userRefSelect } from "../lib/dto.ts";
import { audit } from "../lib/audit.ts";
import { requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";

export const releaseRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  app.get("/projects/:owner/:slug/releases", { schema: { params: ProjectParams } }, async (req) => {
    const { project, role } = await authorize(db, req.params, req.viewer, "project.view");
    const [releases, deployments] = await Promise.all([
      db.release.findMany({
        where: { projectId: project.id },
        include: { createdBy: { select: userRefSelect } },
        orderBy: { shippedAt: "desc" },
        take: 100,
      }),
      db.deployment.findMany({
        where: { projectId: project.id, ...(role ? {} : { state: "SUCCESS", repository: { isPrivate: false } }) },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    return { releases: releases.map(toRelease), deployments: deployments.map(toDeployment) };
  });

  app.post("/projects/:owner/:slug/ship", { schema: { params: ProjectParams, body: ShipInput } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "project.ship");
    const { release, shipped } = await recordRelease(db, {
      projectId: project.id,
      title: req.body.title,
      version: req.body.version ?? null,
      notes: req.body.notes ?? null,
      url: req.body.url ?? project.homepageUrl,
      source: "MANUAL",
      createdById: viewer.id,
      forceShip: true,
    });
    await audit(db, req, { projectId: project.id, action: "project.ship", targetId: release.id });
    return reply.status(201).send({ id: release.id, shipped });
  });

  /**
   * What changed, from facts: merged pull requests and completed tasks between two releases (or
   * since the latest one). Tasks are members-only, so visitors get the pull request sections.
   */
  app.get(
    "/projects/:owner/:slug/changelog",
    { schema: { params: ProjectParams, querystring: z.object({ release: z.uuid().optional() }) } },
    async (req) => {
      const access = await authorize(db, req.params, req.viewer, "project.view");
      const { project } = access;
      const includeTasks = can("tasks.view", { role: access.role, visibility: project.visibility });

      let to = new Date();
      let toLabel = "Unreleased";
      let toRelease: { shippedAt: Date } | null = null;
      if (req.query.release) {
        const r = await db.release.findFirst({ where: { id: req.query.release, projectId: project.id }, select: { shippedAt: true, version: true, title: true } });
        if (!r) throw notFound("Release not found");
        to = r.shippedAt;
        toLabel = r.version ?? r.title;
        toRelease = r;
      }
      const previous = await db.release.findFirst({
        where: { projectId: project.id, shippedAt: { lt: toRelease ? toRelease.shippedAt : to } },
        orderBy: { shippedAt: "desc" },
        select: { shippedAt: true, version: true, title: true },
      });
      const from = previous?.shippedAt ?? null;
      const range = { ...(from ? { gt: from } : {}), lte: to };
      const LIMIT = 500;

      const [prs, tasks] = await Promise.all([
        db.pullRequest.findMany({
          where: { state: "MERGED", mergedAt: range, repository: { projects: { some: { projectId: project.id } } } },
          select: {
            number: true,
            title: true,
            htmlUrl: true,
            authorLogin: true,
            mergedAt: true,
            additions: true,
            deletions: true,
            repository: { select: { fullName: true } },
            tasks: { where: { task: { projectId: project.id } }, select: { task: { select: { number: true } } } },
          },
          orderBy: { mergedAt: "asc" },
          take: LIMIT + 1,
        }),
        includeTasks
          ? db.task.findMany({ where: { projectId: project.id, status: "DONE", completedAt: range }, select: { number: true, title: true, completedAt: true }, orderBy: { completedAt: "asc" }, take: LIMIT })
          : [],
      ]);
      const truncated = prs.length > LIMIT;
      const kept = prs.slice(0, LIMIT);
      const changelog = buildChangelog(
        kept.map((p) => ({
          number: p.number,
          title: p.title,
          url: p.htmlUrl,
          repo: p.repository.fullName,
          author: p.authorLogin === "ghost" ? null : p.authorLogin,
          mergedAt: p.mergedAt!,
          additions: p.additions,
          deletions: p.deletions,
          tasks: includeTasks ? p.tasks.map((t) => taskIdentifier(project.key, t.task.number)) : [],
        })),
        tasks.map((t) => ({ identifier: taskIdentifier(project.key, t.number), title: t.title, completedAt: t.completedAt! })),
        { includeTasks },
      );
      const multiRepo = new Set(kept.map((p) => p.repository.fullName)).size > 1;
      const dto: ChangelogDto = {
        range: { from: from?.toISOString() ?? null, to: to.toISOString(), fromLabel: previous ? (previous.version ?? previous.title) : null, toLabel },
        ...changelog,
        markdown: changelogMarkdown(changelog, { multiRepo }),
        truncated,
      };
      return dto;
    },
  );
};
