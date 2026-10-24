import { CursorQuery, UpdateProfileInput, type BuildHistoryEntry, type ProfileProject, type ProfileTech, type PublicProfile } from "@bldt/contracts";
import type { Db, User } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { afterCursor, decodeCursor, page } from "../lib/cursor.ts";
import { activityInclude, projectCardInclude, sumContributions, toActivity, toProjectCard } from "../lib/dto.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { requireBrowserSession, requireViewer } from "../plugins/auth.ts";
import { outsiderActivityFilter } from "../lib/activity-visibility.ts";

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  app.get("/users/:username", { schema: { params: z.object({ username: z.string().min(1).max(39) }) } }, async (req) => {
    const user = await db.user.findFirst({ where: { username: req.params.username.toLowerCase(), deletedAt: null } });
    if (!user) throw notFound("User not found");
    return buildProfile(db, user, req.viewer);
  });

  /** Public activity across projects the viewer can see. */
  app.get(
    "/users/:username/activity",
    { schema: { params: z.object({ username: z.string().min(1).max(39) }), querystring: CursorQuery } },
    async (req) => {
      const user = await db.user.findFirst({ where: { username: req.params.username.toLowerCase(), deletedAt: null } });
      if (!user) throw notFound("User not found");
      const visible = await visibleProjectIds(db, user.id, req.viewer);
      const cursor = decodeCursor(req.query.cursor);
      // Full detail only for projects the viewer is a member of; the public slice elsewhere.
      const viewerMember = req.viewer
        ? new Set((await db.projectMember.findMany({ where: { userId: req.viewer.id, projectId: { in: [...visible] } }, select: { projectId: true } })).map((m) => m.projectId))
        : new Set<string>();
      const outsiderProjects = [...visible].filter((id) => !viewerMember.has(id));
      const outsider = await outsiderActivityFilter(db, outsiderProjects);
      const login = (await db.githubAccount.findUnique({ where: { userId: user.id }, select: { login: true } }))?.login;
      const rows = await db.activityEvent.findMany({
        where: {
          AND: [
            { OR: [{ projectId: { in: [...viewerMember] } }, { AND: [{ projectId: { in: outsiderProjects } }, outsider] }] },
            { OR: [{ actorId: user.id }, ...(login ? [{ actorLogin: login }] : [])] },
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

  app.patch("/me", { schema: { body: UpdateProfileInput } }, async (req) => {
    const viewer = requireViewer(req);
    const input = req.body;
    if (input.username && input.username !== viewer.username) {
      throw conflict("Your username is shared with your articles and cannot be changed here.", { field: "username" });
    }
    const u = await db.user.update({ where: { id: viewer.id }, data: input });
    // Shared profiles also appear in A's cached article cards and post pages.
    try {
      for (const pattern of ["post:*", "feed:latest:page:*"]) {
        let cursor = "0";
        do {
          const [next, keys] = await app.deps.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
          cursor = next;
          if (keys.length) await app.deps.redis.del(...keys);
        } while (cursor !== "0");
      }
    } catch {
      req.log.warn("Could not invalidate community profile caches; TTLs will expire stale entries.");
    }
    return { username: u.username };
  });

  /** Everything we hold about the user, as JSON. */
  app.get("/me/export", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const [memberships, tasksCreated, tasksAssigned, comments, contributions, notifications, sessions, github, workRecords] = await Promise.all([
      db.projectMember.findMany({ where: { userId: viewer.id }, include: { project: { select: { name: true, slug: true, visibility: true, stage: true } } } }),
      db.task.findMany({ where: { creatorId: viewer.id }, select: { title: true, status: true, createdAt: true, project: { select: { name: true, key: true } }, number: true } }),
      db.task.findMany({ where: { assigneeId: viewer.id }, select: { title: true, status: true, project: { select: { name: true, key: true } }, number: true } }),
      db.comment.findMany({ where: { authorId: viewer.id, deletedAt: null }, select: { body: true, createdAt: true, subjectType: true } }),
      db.contribution.findMany({ where: { userId: viewer.id }, include: { repository: { select: { fullName: true } } } }),
      db.notification.findMany({ where: { recipientId: viewer.id }, orderBy: { createdAt: "desc" }, take: 500 }),
      db.session.findMany({ where: { userId: viewer.id }, select: { createdAt: true, lastSeenAt: true, userAgent: true, ip: true } }),
      db.githubAccount.findUnique({ where: { userId: viewer.id }, select: { login: true, githubUserId: true, createdAt: true } }),
      // Exported as the signed documents, so they stay verifiable outside bld.t.
      db.workRecord.findMany({ where: { userId: viewer.id }, orderBy: { createdAt: "asc" } }),
    ]);
    const { id: _id, ...profile } = viewer;
    reply.header("content-disposition", `attachment; filename="bldt-export-${viewer.username}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      profile,
      github,
      memberships,
      tasksCreated,
      tasksAssigned,
      comments,
      contributions,
      notifications,
      workRecords: workRecords.map((r) => ({
        signed: { record: JSON.parse(r.canonical), signature: { alg: "Ed25519", kid: r.kid, value: r.signature } },
        revokedAt: r.revokedAt,
      })),
      sessions,
    };
  });

  app.delete("/me", { schema: { body: z.object({ confirm: z.string() }) } }, async (req) => {
    // The original B handler only deleted B's data. It must never partially
    // delete A's shared identity and leave published articles orphaned.
    requireBrowserSession(req);
    throw conflict("Workspace-only deletion is disabled because your identity is shared with the community. Your account and articles have not been changed.");
  });
};

/** Projects of `userId` that `viewer` may see on the profile. Unlisted projects are shown only to their members. */
async function visibleProjectIds(db: Db, userId: string, viewer: User | null): Promise<Set<string>> {
  const memberships = await db.projectMember.findMany({
    where: { userId, project: { deletedAt: null } },
    select: { projectId: true, showOnProfile: true, project: { select: { visibility: true } } },
  });
  const viewerProjects = viewer
    ? new Set(
        (await db.projectMember.findMany({ where: { userId: viewer.id }, select: { projectId: true } })).map((m) => m.projectId),
      )
    : new Set<string>();
  const isSelf = viewer?.id === userId;

  return new Set(
    memberships
      .filter((m) => {
        if (isSelf) return true;
        if (!m.showOnProfile) return false;
        return m.project.visibility === "PUBLIC" || viewerProjects.has(m.projectId);
      })
      .map((m) => m.projectId),
  );
}

async function buildProfile(db: Db, user: User, viewer: User | null): Promise<PublicProfile> {
  const isSelf = viewer?.id === user.id;
  const visible = await visibleProjectIds(db, user.id, viewer);
  const [github, memberships, allMemberships, contributions] = await Promise.all([
    db.githubAccount.findUnique({ where: { userId: user.id }, select: { login: true } }),
    db.projectMember.findMany({
      where: { userId: user.id, projectId: { in: [...visible] } },
      include: { project: { include: { ...projectCardInclude, _count: { select: { members: true, releases: true } } } } },
    }),
    // Only projects the member chose to show count toward anonymous private totals.
    db.projectMember.findMany({ where: { userId: user.id, showOnProfile: true, project: { deletedAt: null } }, select: { projectId: true } }),
    db.contribution.findMany({ where: { userId: user.id, project: { deletedAt: null } } }),
  ]);

  const contribByProject = new Map<string, typeof contributions>();
  for (const c of contributions) contribByProject.set(c.projectId, [...(contribByProject.get(c.projectId) ?? []), c]);

  const projects: ProfileProject[] = memberships
    .map((m) => ({
      ...toProjectCard(m.project),
      role: m.role,
      title: m.title,
      contribution: sumContributions(contribByProject.get(m.projectId) ?? []),
      releases: m.project._count.releases,
      _order: m.profileOrder,
    }))
    .sort((a, b) => {
      // Pinned order first, then shipped, then most recently updated.
      if (a._order != null || b._order != null) return (a._order ?? 1e9) - (b._order ?? 1e9);
      const shipRank = (p: ProfileProject) => (p.shippedAt ? 0 : 1);
      return shipRank(a) - shipRank(b) || b.updatedAt.localeCompare(a.updatedAt);
    })
    .map(({ _order, ...p }) => p);

  // Technologies weighted by evidence of this person's own contributions.
  const techMap = new Map<string, ProfileTech>();
  for (const p of projects) {
    const evidenced = Boolean(p.contribution && (p.contribution.commits > 0 || p.contribution.prsMerged > 0));
    for (const t of p.technologies) {
      const cur = techMap.get(t.slug) ?? { ...t, projects: 0, evidenced: false };
      cur.projects += 1;
      cur.evidenced ||= evidenced;
      techMap.set(t.slug, cur);
    }
  }
  const technologies = [...techMap.values()].sort(
    (a, b) => Number(b.evidenced) - Number(a.evidenced) || b.projects - a.projects || a.name.localeCompare(b.name),
  );

  const visibleIds = new Set(projects.map((p) => p.id));
  const collaborators = visibleIds.size
    ? await db.projectMember.findMany({
        where: { projectId: { in: [...visibleIds] }, userId: { not: user.id } },
        distinct: ["userId"],
        select: { userId: true },
      })
    : [];

  const visibleContrib = contributions.filter((c) => visibleIds.has(c.projectId));
  const hiddenProjectIds = new Set(allMemberships.map((m) => m.projectId).filter((id) => !visibleIds.has(id)));
  const hiddenContrib = contributions.filter((c) => hiddenProjectIds.has(c.projectId));

  const history = await buildHistory(db, user.id, memberships.map((m) => m.project));

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    headline: user.headline,
    bio: user.bio,
    location: user.location,
    websiteUrl: user.websiteUrl,
    focusAreas: user.focusAreas,
    openToWork: user.openToWork,
    githubLogin: github?.login ?? null,
    joinedAt: user.createdAt.toISOString(),
    summary: {
      shipped: projects.filter((p) => p.shippedAt).length,
      building: projects.filter((p) => p.stage === "BUILDING").length,
      collaborators: collaborators.length,
      mergedPrs: visibleContrib.reduce((a, c) => a + c.prsMerged, 0),
      reviews: visibleContrib.reduce((a, c) => a + c.reviews, 0),
      privateProjects: hiddenProjectIds.size,
      privateMergedPrs: hiddenContrib.reduce((a, c) => a + c.prsMerged, 0),
    },
    technologies,
    projects,
    history,
    isSelf,
  };
}

async function buildHistory(
  db: Db,
  userId: string,
  projects: { id: string; name: string; slug: string; owner: { username: string }; createdAt: Date; ownerId: string; sunsetAt: Date | null; stage: string }[],
): Promise<BuildHistoryEntry[]> {
  if (projects.length === 0) return [];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const ref = (p: { name: string; slug: string; owner: { username: string } }) => ({ name: p.name, slug: p.slug, ownerUsername: p.owner.username });

  const [releases, joins] = await Promise.all([
    db.release.findMany({ where: { projectId: { in: [...byId.keys()] } }, orderBy: { shippedAt: "desc" }, take: 60 }),
    db.projectMember.findMany({ where: { userId, projectId: { in: [...byId.keys()] } }, select: { projectId: true, joinedAt: true, role: true } }),
  ]);

  const entries: BuildHistoryEntry[] = [];
  for (const r of releases) {
    const p = byId.get(r.projectId)!;
    entries.push({
      id: `release:${r.id}`,
      kind: r.isShip ? "shipped" : "release",
      project: ref(p),
      title: r.title,
      version: r.version,
      url: r.url,
      trust: r.source === "MANUAL" ? "PLATFORM" : "CONNECTED",
      occurredAt: r.shippedAt.toISOString(),
    });
  }
  for (const j of joins) {
    const p = byId.get(j.projectId)!;
    const started = j.role === "OWNER" && p.ownerId === userId;
    entries.push({
      id: `${started ? "start" : "join"}:${p.id}`,
      kind: started ? "started" : "joined",
      project: ref(p),
      title: started ? `Started ${p.name}` : `Joined ${p.name}`,
      version: null,
      url: null,
      trust: "PLATFORM",
      occurredAt: (started ? p.createdAt : j.joinedAt).toISOString(),
    });
    if (p.stage === "SUNSET" && p.sunsetAt) {
      entries.push({
        id: `sunset:${p.id}`,
        kind: "sunset",
        project: ref(p),
        title: `Sunset ${p.name}`,
        version: null,
        url: null,
        trust: "PLATFORM",
        occurredAt: p.sunsetAt.toISOString(),
      });
    }
  }
  return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 60);
}
