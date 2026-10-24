import {
  ChangeStageInput,
  ConnectRepositoriesInput,
  CreateProjectInput,
  CursorQuery,
  permissionsFor,
  slugify,
  suggestProjectKey,
  UpdateProjectInput,
  UpdateTechnologiesInput,
  type ProjectDetail,
  type ProjectTech,
} from "@bldt/contracts";
import { platformEvent, recordActivity } from "@bldt/core";
import type { Db } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize, resolveProject } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { afterCursor, decodeCursor, page } from "../lib/cursor.ts";
import {
  activityInclude,
  iso,
  projectCardInclude,
  toActivity,
  toDeployment,
  toMilestone,
  toProjectCard,
} from "../lib/dto.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { verifyAndUpsertRepositories } from "../lib/repos.ts";
import { requireBrowserSession, requireViewer } from "../plugins/auth.ts";
import { outsiderActivityFilter } from "../lib/activity-visibility.ts";

export const ProjectParams = z.object({ owner: z.string().min(1).max(39), slug: z.string().min(1).max(64) });

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, jobs } = app.deps;

  app.post("/projects", { schema: { body: CreateProjectInput } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const input = req.body;

    const slug = await uniqueSlug(db, viewer.id, input.slug ?? slugify(input.name));
    const key = input.key
      ? await assertKeyFree(db, viewer.id, input.key)
      : await uniqueKey(db, viewer.id, suggestProjectKey(input.name));

    const repos = input.repositoryGithubIds.length
      ? await verifyAndUpsertRepositories(app.deps, viewer.id, input.repositoryGithubIds)
      : [];

    const project = await db.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          ownerId: viewer.id,
          slug,
          key,
          name: input.name,
          tagline: input.tagline ?? null,
          stage: input.stage,
          visibility: input.visibility,
          members: { create: { userId: viewer.id, role: "OWNER" } },
          repositories: { create: repos.map((r, i) => ({ repositoryId: r.id, isPrimary: i === 0 })) },
        },
      });
      await recordActivity(tx, platformEvent(p.id, "project.created", viewer.id, { name: p.name }));
      await audit(tx, req, { projectId: p.id, action: "project.create", metadata: { visibility: p.visibility } });
      return p;
    });

    for (const r of repos) await jobs.enqueue("repo.sync", { repositoryId: r.id, reason: "connect" }, { dedupeId: r.id });

    return reply.status(201).send({ owner: viewer.username, slug: project.slug, key: project.key });
  });

  app.get("/projects/:owner/:slug", { schema: { params: ProjectParams } }, async (req) => {
    const { project, role } = await resolveProject(db, req.params.owner, req.params.slug, req.viewer);
    return projectDetail(db, project.id, role, req.viewer?.id ?? null);
  });

  app.patch("/projects/:owner/:slug", { schema: { params: ProjectParams, body: UpdateProjectInput } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "project.update");
    const input = req.body;

    if (input.slug && input.slug !== project.slug) await uniqueSlug(db, project.ownerId, input.slug, true);
    if (input.visibility && input.visibility !== project.visibility) {
      // Exposing a team's work publicly is the owner's call, made at the website.
      requireBrowserSession(req);
      await authorize(db, req.params, viewer, "project.visibility");
    }

    const updated = await db.project.update({
      where: { id: project.id },
      data: {
        name: input.name,
        slug: input.slug,
        tagline: input.tagline,
        description: input.description,
        visibility: input.visibility,
        homepageUrl: input.homepageUrl,
        openToContributors: input.openToContributors,
        lookingFor: input.lookingFor,
      },
    });

    if (input.visibility && input.visibility !== project.visibility) {
      await audit(db, req, {
        projectId: project.id,
        action: "project.visibility",
        metadata: { from: project.visibility, to: input.visibility },
      });
    }
    return { owner: project.owner.username, slug: updated.slug };
  });

  app.delete(
    "/projects/:owner/:slug",
    { schema: { params: ProjectParams, body: z.object({ confirm: z.string() }) } },
    async (req) => {
      const viewer = requireBrowserSession(req);
      const { project } = await authorize(db, req.params, viewer, "project.delete");
      if (req.body.confirm !== project.slug) throw badRequest("Type the project slug to confirm deletion");
      // Soft delete frees the slug/key by suffixing so the owner can reuse the name.
      const stamp = Date.now().toString(36);
      await db.project.update({
        where: { id: project.id },
        data: { deletedAt: new Date(), slug: `${project.slug}--deleted-${stamp}`, key: `X${stamp.toUpperCase()}`.slice(0, 10) },
      });
      await audit(db, req, { projectId: project.id, action: "project.delete" });
      return { ok: true };
    },
  );

  app.post("/projects/:owner/:slug/stage", { schema: { params: ProjectParams, body: ChangeStageInput } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "project.update");
    const { stage, retrospective } = req.body;
    if (stage === project.stage) return { stage };
    if (stage === "SHIPPED" && !project.shippedAt) {
      throw badRequest("Use Ship to mark the first release, so the launch is recorded with notes and a date");
    }

    await db.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id },
        data: {
          stage,
          ...(stage === "SUNSET" ? { sunsetAt: new Date() } : {}),
          ...(retrospective !== undefined ? { retrospective } : {}),
        },
      });
      await recordActivity(
        tx,
        platformEvent(project.id, "project.stage_changed", viewer.id, { from: project.stage, to: stage, retrospective: retrospective ?? null }),
      );
    });
    return { stage };
  });

  // ── Repositories ────────────────────────────────────────────

  app.post(
    "/projects/:owner/:slug/repositories",
    { schema: { params: ProjectParams, body: ConnectRepositoriesInput } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "project.integrations");
      const repos = await verifyAndUpsertRepositories(app.deps, viewer.id, req.body.repositoryGithubIds);
      const hasPrimary = (await db.projectRepository.count({ where: { projectId: project.id, isPrimary: true } })) > 0;

      for (const [i, r] of repos.entries()) {
        await db.projectRepository.upsert({
          where: { projectId_repositoryId: { projectId: project.id, repositoryId: r.id } },
          create: { projectId: project.id, repositoryId: r.id, isPrimary: !hasPrimary && i === 0 },
          update: {},
        });
        await jobs.enqueue("repo.sync", { repositoryId: r.id, reason: "connect" }, { dedupeId: r.id });
      }
      await audit(db, req, {
        projectId: project.id,
        action: "integration.connect",
        metadata: { repositories: repos.map((r) => r.githubId.toString()) },
      });
      return { ok: true };
    },
  );

  app.delete(
    "/projects/:owner/:slug/repositories/:repositoryId",
    { schema: { params: ProjectParams.extend({ repositoryId: z.uuid() }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "project.integrations");
      const link = await db.projectRepository.findUnique({
        where: { projectId_repositoryId: { projectId: project.id, repositoryId: req.params.repositoryId } },
      });
      if (!link) throw notFound("Repository is not connected");
      await db.projectRepository.delete({ where: { projectId_repositoryId: { projectId: project.id, repositoryId: req.params.repositoryId } } });
      if (link.isPrimary) {
        const next = await db.projectRepository.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } });
        if (next) await db.projectRepository.update({ where: { projectId_repositoryId: { projectId: project.id, repositoryId: next.repositoryId } }, data: { isPrimary: true } });
      }
      await jobs.enqueue("project.recompute", { projectId: project.id }, { dedupeId: project.id });
      await audit(db, req, { projectId: project.id, action: "integration.disconnect", targetId: req.params.repositoryId });
      return { ok: true };
    },
  );

  app.post(
    "/projects/:owner/:slug/repositories/:repositoryId/sync",
    {
      schema: { params: ProjectParams.extend({ repositoryId: z.uuid() }) },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "project.integrations");
      const link = await db.projectRepository.findUnique({
        where: { projectId_repositoryId: { projectId: project.id, repositoryId: req.params.repositoryId } },
      });
      if (!link) throw notFound("Repository is not connected");
      await db.repository.update({ where: { id: req.params.repositoryId }, data: { syncStatus: "QUEUED", syncError: null } });
      await jobs.enqueue("repo.sync", { repositoryId: req.params.repositoryId, reason: "manual" }, { dedupeId: req.params.repositoryId });
      return { ok: true };
    },
  );

  /** Recent webhook deliveries for the project's repositories, so owners can see integration health. */
  app.get("/projects/:owner/:slug/deliveries", { schema: { params: ProjectParams } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "project.integrations");
    const repos = await db.projectRepository.findMany({
      where: { projectId: project.id },
      select: { repository: { select: { githubId: true, fullName: true } } },
    });
    const byId = new Map(repos.map((r) => [r.repository.githubId.toString(), r.repository.fullName]));
    const deliveries = await db.webhookDelivery.findMany({
      where: { repositoryGithubId: { in: repos.map((r) => r.repository.githubId) } },
      orderBy: { receivedAt: "desc" },
      take: 50,
    });
    return {
      items: deliveries.map((d) => ({
        id: d.id,
        event: d.event,
        action: d.action,
        repository: d.repositoryGithubId ? (byId.get(d.repositoryGithubId.toString()) ?? null) : null,
        status: d.status,
        error: d.error,
        attempts: d.attempts,
        receivedAt: d.receivedAt.toISOString(),
        processedAt: iso(d.processedAt),
      })),
    };
  });

  // ── Technologies ────────────────────────────────────────────

  app.patch(
    "/projects/:owner/:slug/technologies",
    { schema: { params: ProjectParams, body: UpdateTechnologiesInput } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "project.update");
      const { add, hide, unhide } = req.body;
      const slugs = [...new Set([...add, ...hide, ...unhide])];
      const techs = await db.technology.findMany({ where: { slug: { in: slugs } } });
      const bySlug = new Map(techs.map((t) => [t.slug, t]));
      const unknown = slugs.filter((s) => !bySlug.has(s));
      if (unknown.length) throw badRequest(`Unknown technologies: ${unknown.join(", ")}`);

      await db.$transaction(async (tx) => {
        for (const s of add) {
          const t = bySlug.get(s)!;
          await tx.projectTechnology.upsert({
            where: { projectId_technologyId: { projectId: project.id, technologyId: t.id } },
            create: { projectId: project.id, technologyId: t.id, source: "MANUAL" },
            update: { hidden: false },
          });
        }
        for (const [list, hidden] of [[hide, true], [unhide, false]] as const) {
          const ids = list.map((s) => bySlug.get(s)!.id);
          if (ids.length) await tx.projectTechnology.updateMany({ where: { projectId: project.id, technologyId: { in: ids } }, data: { hidden } });
        }
      });
      return { ok: true };
    },
  );

  app.get("/technologies", async () => {
    const items = await db.technology.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
    return { items: items.map((t) => ({ slug: t.slug, name: t.name, category: t.category, color: t.color })) };
  });

  // ── Activity & audit ────────────────────────────────────────

  app.get(
    "/projects/:owner/:slug/activity",
    { schema: { params: ProjectParams, querystring: CursorQuery.extend({ type: z.string().max(40).optional() }) } },
    async (req) => {
      const { project, role } = await authorize(db, req.params, req.viewer, "activity.view");
      const cursor = decodeCursor(req.query.cursor);
      // Visitors see the public slice: no members-only events, nothing from private repositories.
      const outsider = role ? {} : await outsiderActivityFilter(db, [project.id]);
      const rows = await db.activityEvent.findMany({
        where: {
          AND: [
            { projectId: project.id, ...(req.query.type ? { type: { startsWith: req.query.type } } : {}) },
            outsider,
            afterCursor("occurredAt", cursor),
          ],
        },
        include: activityInclude,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: req.query.limit + 1,
      });
      const p = page(rows, req.query.limit, (r) => r.occurredAt);
      return { items: p.items.map(toActivity), nextCursor: p.nextCursor };
    },
  );

  app.get("/projects/:owner/:slug/audit", { schema: { params: ProjectParams, querystring: CursorQuery } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "audit.view");
    const cursor = decodeCursor(req.query.cursor);
    const rows = await db.auditLog.findMany({
      where: { projectId: project.id, ...afterCursor("createdAt", cursor) },
      include: { actor: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: req.query.limit + 1,
    });
    const p = page(rows, req.query.limit, (r) => r.createdAt);
    return {
      items: p.items.map((r) => ({
        id: r.id,
        action: r.action,
        actor: r.actor,
        targetId: r.targetId,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: p.nextCursor,
    };
  });
};

// ── helpers ──────────────────────────────────────────────────

async function uniqueSlug(db: Db, ownerId: string, base: string, strict = false): Promise<string> {
  const clean = slugify(base);
  const taken = await db.project.findMany({
    where: { ownerId, slug: { startsWith: clean } },
    select: { slug: true },
  });
  const set = new Set(taken.map((t) => t.slug));
  if (!set.has(clean)) return clean;
  if (strict) throw conflict("You already have a project with this URL", { field: "slug" });
  for (let i = 2; i < 1000; i++) {
    const s = `${clean.slice(0, 60)}-${i}`;
    if (!set.has(s)) return s;
  }
  throw conflict("Could not find an available project URL");
}

async function assertKeyFree(db: Db, ownerId: string, key: string): Promise<string> {
  const exists = await db.project.findUnique({ where: { ownerId_key: { ownerId, key } }, select: { id: true } });
  if (exists) throw conflict(`You already use the key ${key} on another project`, { field: "key" });
  return key;
}

async function uniqueKey(db: Db, ownerId: string, base: string): Promise<string> {
  const taken = new Set(
    (await db.project.findMany({ where: { ownerId, key: { startsWith: base.slice(0, 8) } }, select: { key: true } })).map((p) => p.key),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const k = `${base.slice(0, 8)}${i}`;
    if (!taken.has(k)) return k;
  }
  throw conflict("Could not derive a project key; please choose one");
}

export async function projectDetail(db: Db, projectId: string, role: ProjectDetail["viewer"]["role"], viewerId: string | null): Promise<ProjectDetail> {
  const [p, repos, allTech, taskGroups, releaseCount, contributors, mergedPrs, milestones, deployments, pendingReq, pendingInvite] =
    await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: projectId }, include: projectCardInclude }),
      db.projectRepository.findMany({
        where: { projectId },
        include: { repository: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      }),
      db.projectTechnology.findMany({ where: { projectId }, include: { technology: true }, orderBy: { share: "desc" } }),
      db.task.groupBy({ by: ["status"], where: { projectId }, _count: true }),
      db.release.count({ where: { projectId } }),
      db.contribution.count({ where: { projectId } }),
      // Outsiders never learn anything about private repositories, not even counts.
      db.pullRequest.count({ where: { state: "MERGED", repository: { projects: { some: { projectId } }, ...(role ? {} : { isPrivate: false }) } } }),
      // Enum order is PLANNED < ACTIVE, so desc puts the active milestone first.
      db.milestone.findMany({ where: { projectId, status: { in: ["ACTIVE", "PLANNED"] } }, orderBy: [{ status: "desc" }, { position: "asc" }], take: 1 }),
      latestDeployments(db, projectId, !role),
      viewerId && !role
        ? db.joinRequest.findFirst({ where: { projectId, userId: viewerId, status: "PENDING" }, select: { id: true } })
        : null,
      viewerId && !role
        ? db.invitation.findFirst({ where: { projectId, inviteeId: viewerId, status: "PENDING", expiresAt: { gt: new Date() } }, select: { id: true } })
        : null,
    ]);

  const count = (statuses: string[]) => taskGroups.filter((g) => statuses.includes(g.status)).reduce((a, g) => a + g._count, 0);
  const canSeeWork = role != null;

  const activeMs = milestones[0];
  let activeMilestone = null;
  if (activeMs && canSeeWork) {
    const [total, done] = await Promise.all([
      db.task.count({ where: { milestoneId: activeMs.id, status: { not: "CANCELED" } } }),
      db.task.count({ where: { milestoneId: activeMs.id, status: "DONE" } }),
    ]);
    activeMilestone = toMilestone(activeMs, { total, done });
  }

  const primary = repos.find((r) => r.isPrimary) ?? repos[0];
  const card = toProjectCard(p);

  return {
    ...card,
    description: p.description,
    retrospective: p.retrospective,
    sunsetAt: iso(p.sunsetAt),
    createdAt: p.createdAt.toISOString(),
    // Outsiders never see private repository metadata, even on a public project.
    repositories: repos
      .filter((r) => canSeeWork || !r.repository.isPrivate)
      .map((r) => ({
        id: r.repository.id,
        githubId: Number(r.repository.githubId),
        fullName: r.repository.fullName,
        htmlUrl: r.repository.htmlUrl,
        isPrivate: r.repository.isPrivate,
        isPrimary: r.isPrimary,
        defaultBranch: r.repository.defaultBranch,
        primaryLanguage: r.repository.primaryLanguage,
        stars: r.repository.stars,
        pushedAt: iso(r.repository.pushedAt),
        syncStatus: r.repository.syncStatus,
        syncError: canSeeWork ? r.repository.syncError : null,
        lastSyncedAt: iso(r.repository.lastSyncedAt),
      })),
    readme: primary && (canSeeWork || !primary.repository.isPrivate) ? primary.repository.readme : null,
    allTechnologies: allTech
      .filter((t) => canSeeWork || !t.hidden)
      .map(
        (t): ProjectTech => ({
          slug: t.technology.slug,
          name: t.technology.name,
          category: t.technology.category,
          color: t.technology.color,
          source: t.source,
          share: t.share,
          evidence: t.evidence,
          hidden: t.hidden,
        }),
      ),
    viewer: {
      role: role,
      permissions: permissionsFor(role, p.visibility),
      pendingJoinRequest: Boolean(pendingReq),
      pendingInvitationId: pendingInvite?.id ?? null,
    },
    stats: {
      openTasks: canSeeWork ? count(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"]) : 0,
      doneTasks: count(["DONE"]),
      releases: releaseCount,
      contributors,
      mergedPrs,
    },
    activeMilestone,
    latestDeployments: canSeeWork ? deployments.map(toDeployment) : deployments.filter((d) => d.state === "SUCCESS").map(toDeployment),
  };
}

/** Most recent deployment per environment. */
async function latestDeployments(db: Db, projectId: string, publicReposOnly: boolean) {
  const rows = await db.deployment.findMany({
    where: { projectId, ...(publicReposOnly ? { repository: { isPrivate: false } } : {}) },
    orderBy: { createdAt: "desc" },
    distinct: ["environment"],
    take: 6,
  });
  return rows;
}
