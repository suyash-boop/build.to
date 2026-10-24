import {
  FullSearchQuery,
  SearchQuery,
  taskIdentifier,
  type DiscussionHit,
  type FullSearchResults,
  type PullRequestHit,
  type ReleaseHit,
  type SearchResults,
  type TaskHit,
  type TaskStatus,
} from "@bldt/contracts";
import { Prisma, type Db } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { HEADLINE_OPTIONS, toHighlight, toPrefixQuery } from "../lib/fts.ts";
import { toUserRef, userRefSelect } from "../lib/dto.ts";

/*
 * Full-text search over Postgres GIN expression indexes (migration full_text_search). The
 * expressions below must match the index definitions exactly or Postgres falls back to a scan.
 * Visibility is enforced inside each query: tasks, discussions, and pull requests are members-only;
 * releases are visible for public projects too.
 */

const TASK_VEC = Prisma.sql`(setweight(to_tsvector('english', coalesce(t."title", '')), 'A') || setweight(to_tsvector('english', coalesce(t."description", '')), 'B'))`;
const DISC_VEC = Prisma.sql`(setweight(to_tsvector('english', coalesce(d."title", '')), 'A') || setweight(to_tsvector('english', coalesce(d."body", '')), 'B') || setweight(to_tsvector('english', coalesce(d."errorMessage", '')), 'C'))`;
const REPLY_VEC = Prisma.sql`(to_tsvector('english', coalesce(r."body", '')))`;
const PR_VEC = Prisma.sql`(to_tsvector('english', coalesce(pr."title", '')))`;
const REL_VEC = Prisma.sql`(setweight(to_tsvector('english', coalesce(rl."title", '')), 'A') || setweight(to_tsvector('english', coalesce(rl."notes", '')), 'B'))`;

interface Scope {
  viewerId: string | null;
  projectId: string | null;
}

const memberOf = (projectAlias: Prisma.Sql, viewerId: string | null) =>
  viewerId ? Prisma.sql`EXISTS (SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = ${projectAlias} AND m."userId" = ${viewerId})` : Prisma.sql`FALSE`;
const inProject = (projectAlias: Prisma.Sql, projectId: string | null) => (projectId ? Prisma.sql`AND ${projectAlias} = ${projectId}::uuid` : Prisma.empty);

type ProjectCols = { p_name: string; p_slug: string; p_owner: string };
const project = (r: ProjectCols) => ({ name: r.p_name, slug: r.p_slug, ownerUsername: r.p_owner });

async function searchTasks(db: Db, q: string, s: Scope, limit: number, offset: number): Promise<TaskHit[]> {
  if (!s.viewerId) return [];
  const rows = await db.$queryRaw<(ProjectCols & { number: number; title: string; status: TaskStatus; key: string; rank: number; headline: string })[]>`
    SELECT t."number", t."title", t."status", p."key", p."name" AS p_name, p."slug" AS p_slug, u."username" AS p_owner,
           ts_rank_cd(${TASK_VEC}, query) AS rank,
           ts_headline('english', coalesce(t."description", ''), query, ${HEADLINE_OPTIONS}) AS headline
    FROM "Task" t
    JOIN "Project" p ON p."id" = t."projectId"
    JOIN "user" u ON u."id" = p."ownerId",
    to_tsquery('english', ${q}) query
    WHERE ${TASK_VEC} @@ query AND p."deletedAt" IS NULL AND ${memberOf(Prisma.sql`p."id"`, s.viewerId)} ${inProject(Prisma.sql`p."id"`, s.projectId)}
    ORDER BY rank DESC, t."updatedAt" DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map((r) => ({
    identifier: taskIdentifier(r.key, r.number),
    number: r.number,
    title: r.title,
    status: r.status,
    project: project(r),
    snippet: toHighlight(r.headline),
    rank: Number(r.rank),
  }));
}

async function searchDiscussions(db: Db, q: string, s: Scope, limit: number, offset: number): Promise<DiscussionHit[]> {
  if (!s.viewerId) return [];
  // Threads that match themselves, and threads where a reply matches; best rank wins per thread.
  // Membership narrows the candidate set first, and highlighting (the expensive part) runs only on
  // the final page of rows, never on every match.
  const rows = await db.$queryRaw<(ProjectCols & { number: number; title: string; category: DiscussionHit["category"]; solved: boolean; rank: number; headline: string; in_reply: boolean })[]>`
    WITH scope AS (
      SELECT p."id" FROM "Project" p
      JOIN "ProjectMember" m ON m."projectId" = p."id" AND m."userId" = ${s.viewerId}
      WHERE p."deletedAt" IS NULL ${inProject(Prisma.sql`p."id"`, s.projectId)}
    ),
    hits AS (
      SELECT d."id" AS did, ts_rank_cd(${DISC_VEC}, query) AS rank, FALSE AS in_reply, NULL::uuid AS reply_id
      FROM "Discussion" d, to_tsquery('english', ${q}) query
      WHERE d."projectId" IN (SELECT "id" FROM scope) AND ${DISC_VEC} @@ query AND d."deletedAt" IS NULL
      UNION ALL
      SELECT r."discussionId", ts_rank_cd(${REPLY_VEC}, query) * 0.8, TRUE, r."id"
      FROM "DiscussionReply" r, to_tsquery('english', ${q}) query
      WHERE r."projectId" IN (SELECT "id" FROM scope) AND ${REPLY_VEC} @@ query AND r."deletedAt" IS NULL
    ),
    best AS (
      SELECT DISTINCT ON (did) did, rank, in_reply, reply_id FROM hits ORDER BY did, rank DESC
    ),
    page AS (
      SELECT b.*, d."number", d."title", d."category", d."body", d."errorMessage", d."answerId", d."lastActivityAt", d."projectId"
      FROM best b JOIN "Discussion" d ON d."id" = b.did
      WHERE d."deletedAt" IS NULL
      ORDER BY b.rank DESC, d."lastActivityAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT pg."number", pg."title", pg."category", (pg."answerId" IS NOT NULL) AS solved, pg.rank, pg.in_reply,
           ts_headline('english',
             CASE WHEN pg.in_reply THEN (SELECT r."body" FROM "DiscussionReply" r WHERE r."id" = pg.reply_id)
                  ELSE coalesce(nullif(pg."body", ''), pg."errorMessage", '') END,
             to_tsquery('english', ${q}), ${HEADLINE_OPTIONS}) AS headline,
           p."name" AS p_name, p."slug" AS p_slug, u."username" AS p_owner
    FROM page pg
    JOIN "Project" p ON p."id" = pg."projectId"
    JOIN "user" u ON u."id" = p."ownerId"
    ORDER BY pg.rank DESC, pg."lastActivityAt" DESC`;
  return rows.map((r) => ({
    number: r.number,
    title: r.title,
    category: r.category,
    solved: r.solved,
    inReply: r.in_reply,
    project: project(r),
    snippet: toHighlight(r.headline),
    rank: Number(r.rank),
  }));
}

async function searchPullRequests(db: Db, q: string, s: Scope, limit: number, offset: number): Promise<PullRequestHit[]> {
  if (!s.viewerId) return [];
  // A repository can feed several projects; show each PR once, under a project the viewer is in.
  const rows = await db.$queryRaw<(ProjectCols & { number: number; title: string; url: string; state: PullRequestHit["state"]; repo: string; rank: number })[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (pr."id") pr."number", pr."title", pr."htmlUrl" AS url, pr."state", rp."fullName" AS repo,
             ts_rank_cd(${PR_VEC}, query) AS rank, pr."updatedAt" AS updated_at,
             p."name" AS p_name, p."slug" AS p_slug, u."username" AS p_owner
      FROM "PullRequest" pr
      JOIN "Repository" rp ON rp."id" = pr."repositoryId"
      JOIN "ProjectRepository" lnk ON lnk."repositoryId" = rp."id"
      JOIN "Project" p ON p."id" = lnk."projectId"
      JOIN "user" u ON u."id" = p."ownerId",
      to_tsquery('english', ${q}) query
      WHERE ${PR_VEC} @@ query AND p."deletedAt" IS NULL AND ${memberOf(Prisma.sql`p."id"`, s.viewerId)} ${inProject(Prisma.sql`p."id"`, s.projectId)}
      ORDER BY pr."id"
    ) one_per_pr
    ORDER BY rank DESC, updated_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map((r) => ({ number: r.number, title: r.title, url: r.url, state: r.state, repo: r.repo, project: project(r), snippet: [], rank: Number(r.rank) }));
}

async function searchReleases(db: Db, q: string, s: Scope, limit: number, offset: number): Promise<ReleaseHit[]> {
  const rows = await db.$queryRaw<(ProjectCols & { id: string; title: string; version: string | null; shipped_at: Date; rank: number; headline: string })[]>`
    SELECT rl."id", rl."title", rl."version", rl."shippedAt" AS shipped_at,
           ts_rank_cd(${REL_VEC}, query) AS rank,
           ts_headline('english', coalesce(rl."notes", ''), query, ${HEADLINE_OPTIONS}) AS headline,
           p."name" AS p_name, p."slug" AS p_slug, u."username" AS p_owner
    FROM "Release" rl
    JOIN "Project" p ON p."id" = rl."projectId"
    JOIN "user" u ON u."id" = p."ownerId",
    to_tsquery('english', ${q}) query
    WHERE ${REL_VEC} @@ query AND p."deletedAt" IS NULL
      AND (p."visibility" = 'PUBLIC' OR ${memberOf(Prisma.sql`p."id"`, s.viewerId)}) ${inProject(Prisma.sql`p."id"`, s.projectId)}
    ORDER BY rank DESC, rl."shippedAt" DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    version: r.version,
    shippedAt: r.shipped_at.toISOString(),
    project: project(r),
    snippet: toHighlight(r.headline),
    rank: Number(r.rank),
  }));
}

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  /** Powers the command palette: the viewer's projects, tasks, and discussions, then public projects and people. */
  app.get(
    "/search",
    { schema: { querystring: SearchQuery }, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req) => {
      const q = req.query.q;
      const viewerId = req.viewer?.id ?? null;
      const contains = { contains: q, mode: "insensitive" as const };
      const tsq = toPrefixQuery(q);

      const visibleProject: Prisma.ProjectWhereInput = viewerId
        ? { deletedAt: null, OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: viewerId } } }] }
        : { deletedAt: null, visibility: "PUBLIC" };

      // "KEY-12" style lookups jump straight to the task.
      const idMatch = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(q);

      const [projects, byId, tasks, discussions, people] = await Promise.all([
        db.project.findMany({
          where: { AND: [visibleProject, { OR: [{ name: contains }, { slug: contains }, { tagline: contains }] }] },
          select: {
            name: true,
            slug: true,
            stage: true,
            owner: { select: { username: true } },
            members: viewerId ? { where: { userId: viewerId }, select: { userId: true } } : false,
          },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
        viewerId && idMatch
          ? db.task.findMany({
              where: { number: Number(idMatch[2]), project: { key: idMatch[1]!.toUpperCase(), deletedAt: null, members: { some: { userId: viewerId } } } },
              select: { number: true, title: true, status: true, project: { select: { key: true, slug: true, name: true, owner: { select: { username: true } } } } },
              take: 3,
            })
          : [],
        tsq && !idMatch ? searchTasks(db, tsq, { viewerId, projectId: null }, 8, 0) : [],
        tsq && !idMatch ? searchDiscussions(db, tsq, { viewerId, projectId: null }, 5, 0) : [],
        db.user.findMany({
          where: { deletedAt: null, OR: [{ username: contains }, { displayName: contains }] },
          select: userRefSelect,
          take: 5,
        }),
      ]);

      const results: SearchResults = {
        projects: projects
          .map((p) => ({
            name: p.name,
            slug: p.slug,
            stage: p.stage,
            ownerUsername: p.owner.username,
            isMember: Array.isArray(p.members) && p.members.length > 0,
          }))
          .sort((a, b) => Number(b.isMember) - Number(a.isMember)),
        tasks: [
          ...byId.map((t) => ({
            identifier: taskIdentifier(t.project.key, t.number),
            number: t.number,
            title: t.title,
            status: t.status,
            project: { slug: t.project.slug, ownerUsername: t.project.owner.username, name: t.project.name },
          })),
          ...tasks.map((t) => ({ identifier: t.identifier, number: t.number, title: t.title, status: t.status, project: { slug: t.project.slug, ownerUsername: t.project.ownerUsername, name: t.project.name } })),
        ],
        discussions: discussions.map((d) => ({ number: d.number, title: d.title, category: d.category, solved: d.solved, project: d.project })),
        people: people.map(toUserRef),
      };
      return results;
    },
  );

  /** The search page: ranked results with highlighted fragments, all types or one type paged. */
  app.get("/search/full", { schema: { querystring: FullSearchQuery }, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const viewerId = req.viewer?.id ?? null;
    const tsq = toPrefixQuery(req.query.q);
    const empty: FullSearchResults = { tasks: [], discussions: [], pullRequests: [], releases: [], hasMore: false };
    if (!tsq) return empty;

    let projectId: string | null = null;
    if (req.query.project) {
      const [owner, slug] = req.query.project.split("/");
      const p = await db.project.findFirst({ where: { slug, owner: { username: owner }, deletedAt: null }, select: { id: true } });
      if (!p) return empty;
      projectId = p.id;
    }
    const scope = { viewerId, projectId };
    const { type, page } = req.query;
    const per = type ? 25 : 6;
    // One extra row tells us whether another page exists.
    const take = type ? per + 1 : per;
    const offset = type ? (page - 1) * per : 0;
    const want = (t: string) => !type || type === t;

    const [tasks, discussions, pullRequests, releases] = await Promise.all([
      want("tasks") ? searchTasks(db, tsq, scope, take, offset) : [],
      want("discussions") ? searchDiscussions(db, tsq, scope, take, offset) : [],
      want("pull_requests") ? searchPullRequests(db, tsq, scope, take, offset) : [],
      want("releases") ? searchReleases(db, tsq, scope, take, offset) : [],
    ]);
    const hasMore = Boolean(type) && [tasks, discussions, pullRequests, releases].some((l) => l.length > per);
    return {
      tasks: tasks.slice(0, per),
      discussions: discussions.slice(0, per),
      pullRequests: pullRequests.slice(0, per),
      releases: releases.slice(0, per),
      hasMore,
    } satisfies FullSearchResults;
  });
};
