import { DiscoverQuery, PeopleQuery, type SuggestedProject } from "@bldt/contracts";
import type { Prisma } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { afterCursor, decodeCursor, page } from "../lib/cursor.ts";
import { projectCardInclude, toProjectCard } from "../lib/dto.ts";
import { matchScore, personCards, publicMembership } from "../lib/people.ts";
import { requireViewer } from "../plugins/auth.ts";

export const discoverRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  /** Public projects only. Unlisted and private projects never appear here. */
  app.get("/discover/projects", { schema: { querystring: DiscoverQuery } }, async (req) => {
    const q = req.query;
    const sortField = q.sort === "shipped" ? "shippedAt" : "updatedAt";
    // AND keeps the search OR and the cursor OR from overwriting each other.
    const where: Prisma.ProjectWhereInput = {
      AND: [
        {
          deletedAt: null,
          visibility: "PUBLIC",
          ...(q.stage ? { stage: q.stage } : {}),
          ...(q.open !== undefined ? { openToContributors: q.open } : {}),
          ...(q.tech ? { technologies: { some: { hidden: false, technology: { slug: q.tech } } } } : {}),
          ...(q.sort === "shipped" ? { shippedAt: { not: null } } : {}),
        },
        q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: "insensitive" } },
                { tagline: { contains: q.q, mode: "insensitive" } },
                { lookingFor: { has: q.q } },
              ],
            }
          : {},
        afterCursor(sortField, decodeCursor(q.cursor)),
      ],
    };
    const rows = await db.project.findMany({
      where,
      include: projectCardInclude,
      orderBy: [{ [sortField]: "desc" }, { id: "desc" }],
      take: q.limit + 1,
    });
    const p = page(rows, q.limit, (r) => (sortField === "shippedAt" ? r.shippedAt! : r.updatedAt));
    return { items: p.items.map(toProjectCard), nextCursor: p.nextCursor };
  });

  /** Builders with public work, or who are open to work. Evidence-backed technologies come first on each card. */
  app.get("/discover/people", { schema: { querystring: PeopleQuery } }, async (req) => {
    const q = req.query;
    const cursor = decodeCursor(q.cursor);
    const rows = await db.user.findMany({
      where: {
        AND: [
          { deletedAt: null },
          { OR: [{ memberships: { some: publicMembership } }, { openToWork: true }] },
          q.open !== undefined ? { openToWork: q.open } : {},
          q.tech ? { memberships: { some: { ...publicMembership, project: { ...publicMembership.project, technologies: { some: { hidden: false, technology: { slug: q.tech } } } } } } } : {},
          q.q
            ? {
                OR: [
                  { username: { contains: q.q, mode: "insensitive" } },
                  { displayName: { contains: q.q, mode: "insensitive" } },
                  { headline: { contains: q.q, mode: "insensitive" } },
                  { focusAreas: { has: q.q.toLowerCase() } },
                ],
              }
            : {},
          afterCursor("createdAt", cursor),
        ],
      },
      select: { id: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
    });
    const p = page(rows, q.limit, (r) => r.createdAt);
    return { items: await personCards(db, p.items.map((r) => r.id)), nextCursor: p.nextCursor };
  });

  /** Open public projects that fit the signed-in user's stack, with the reason for each match. */
  app.get("/discover/suggestions", async (req) => {
    const viewer = requireViewer(req);
    // The viewer's own private work may inform their own suggestions; nobody else sees this.
    const [mine, contributions, pending] = await Promise.all([
      db.projectMember.findMany({
        where: { userId: viewer.id, project: { deletedAt: null } },
        select: { projectId: true, project: { select: { technologies: { where: { hidden: false }, select: { technology: { select: { slug: true } } } } } } },
      }),
      db.contribution.findMany({ where: { userId: viewer.id }, select: { projectId: true, commits: true, prsMerged: true } }),
      db.joinRequest.findMany({ where: { userId: viewer.id, status: "PENDING" }, select: { projectId: true } }),
    ]);
    const evidencedProjects = new Set(contributions.filter((c) => c.commits > 0 || c.prsMerged > 0).map((c) => c.projectId));
    const profile = new Map<string, { evidenced: boolean }>();
    for (const m of mine) {
      for (const t of m.project.technologies) {
        const cur = profile.get(t.technology.slug) ?? { evidenced: false };
        cur.evidenced ||= evidencedProjects.has(m.projectId);
        profile.set(t.technology.slug, cur);
      }
    }
    if (profile.size === 0) return { items: [] };

    const exclude = [...mine.map((m) => m.projectId), ...pending.map((p) => p.projectId)];
    const candidates = await db.project.findMany({
      where: { deletedAt: null, visibility: "PUBLIC", openToContributors: true, id: { notIn: exclude } },
      include: projectCardInclude,
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    const items: SuggestedProject[] = candidates
      .map((c) => {
        const card = toProjectCard(c);
        const { score, reason } = matchScore(profile, card.technologies);
        return { card, score, reason };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.card.updatedAt.localeCompare(a.card.updatedAt))
      .slice(0, 6)
      .map((x) => ({ ...x.card, reason: x.reason }));
    return { items };
  });

  /**
   * For the landing page: the most recent real task in a public project that a merged pull request
   * from a public repository finished. Null when there is none yet; the page then shows no example.
   */
  app.get("/discover/shipped-task", async (_req, reply) => {
    const t = await db.task.findFirst({
      where: {
        status: "DONE",
        project: { visibility: "PUBLIC", deletedAt: null },
        // Public repositories only: a task title is members-only, and a private repo is private.
        pullRequests: { some: { pullRequest: { state: "MERGED", repository: { isPrivate: false } } } },
      },
      orderBy: { completedAt: "desc" },
      select: {
        number: true,
        title: true,
        createdAt: true,
        completedAt: true,
        project: { select: { name: true, slug: true, key: true, owner: { select: { username: true } } } },
        pullRequests: {
          where: { pullRequest: { state: "MERGED", repository: { isPrivate: false } } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { closes: true, pullRequest: { select: { number: true, title: true, htmlUrl: true, headRef: true, openedAt: true, mergedAt: true, additions: true, deletions: true } } },
        },
      },
    });
    reply.header("cache-control", "public, max-age=60");
    const link = t?.pullRequests[0];
    if (!t || !link) return { task: null };
    const pr = link.pullRequest;
    return {
      task: {
        identifier: `${t.project.key}-${t.number}`,
        number: t.number,
        // The pull request title is public on GitHub; the task title is not.
        title: pr.title,
        project: { name: t.project.name, slug: t.project.slug, ownerUsername: t.project.owner.username },
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
        pullRequest: { number: pr.number, url: pr.htmlUrl, branch: pr.headRef, openedAt: pr.openedAt.toISOString(), mergedAt: pr.mergedAt?.toISOString() ?? null, additions: pr.additions, deletions: pr.deletions, closes: link.closes },
      },
    };
  });

  /** Technologies that appear on at least one public project, with counts, for filter chips. */
  app.get("/discover/technologies", async () => {
    const rows = await db.projectTechnology.groupBy({
      by: ["technologyId"],
      where: { hidden: false, project: { deletedAt: null, visibility: "PUBLIC" } },
      _count: true,
      orderBy: { _count: { technologyId: "desc" } },
      take: 40,
    });
    const techs = await db.technology.findMany({ where: { id: { in: rows.map((r) => r.technologyId) } } });
    const byId = new Map(techs.map((t) => [t.id, t]));
    return {
      items: rows
        .map((r) => {
          const t = byId.get(r.technologyId);
          return t ? { slug: t.slug, name: t.name, category: t.category, color: t.color, projects: r._count } : null;
        })
        .filter(Boolean),
    };
  });
};
