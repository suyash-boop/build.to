import { taskIdentifier, type ActivityItem, type ContributionStats, type DeploymentSummary, type MilestoneSummary, type ProjectCard, type ReleaseItem, type TaskSummary, type UserRef } from "@bldt/contracts";
import type { Prisma } from "@bldt/db";

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const parseDate = (s: string | null | undefined) =>
  s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00.000Z`);

export const userRefSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export function toUserRef(u: { id: string; username: string; displayName: string; avatarUrl: string | null }): UserRef {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl };
}

export const projectCardInclude = {
  owner: { select: userRefSelect },
  technologies: {
    where: { hidden: false },
    include: { technology: true },
    orderBy: [{ share: "desc" }],
  },
  members: {
    include: { user: { select: userRefSelect } },
    orderBy: { joinedAt: "asc" },
    take: 6,
  },
  _count: { select: { members: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectCardRow = Prisma.ProjectGetPayload<{ include: typeof projectCardInclude }>;

const CATEGORY_ORDER = { LANGUAGE: 0, FRAMEWORK: 1, DATABASE: 2, INFRASTRUCTURE: 3, TOOL: 4 } as const;

export function toProjectCard(p: ProjectCardRow): ProjectCard {
  const techs = [...p.technologies]
    .sort((a, b) => CATEGORY_ORDER[a.technology.category] - CATEGORY_ORDER[b.technology.category] || b.share - a.share)
    .map((t) => ({
      slug: t.technology.slug,
      name: t.technology.name,
      category: t.technology.category,
      color: t.technology.color,
    }));
  return {
    id: p.id,
    owner: toUserRef(p.owner),
    slug: p.slug,
    key: p.key,
    name: p.name,
    tagline: p.tagline,
    stage: p.stage,
    visibility: p.visibility,
    homepageUrl: p.homepageUrl,
    openToContributors: p.openToContributors,
    lookingFor: p.lookingFor,
    technologies: techs,
    memberCount: p._count.members,
    members: p.members.map((m) => toUserRef(m.user)),
    shippedAt: iso(p.shippedAt),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export const taskSummaryInclude = {
  assignee: { select: userRefSelect },
  milestone: { select: { id: true, title: true } },
  _count: { select: { pullRequests: true } },
} satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskSummaryInclude }>;

export function toTaskSummary(t: TaskRow, key: string, commentCount = 0): TaskSummary {
  return {
    id: t.id,
    number: t.number,
    identifier: taskIdentifier(key, t.number),
    title: t.title,
    status: t.status,
    priority: t.priority,
    position: t.position,
    assignee: t.assignee ? toUserRef(t.assignee) : null,
    milestone: t.milestone,
    dueOn: isoDate(t.dueOn),
    prCount: t._count.pullRequests,
    commentCount,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    completedAt: iso(t.completedAt),
    github: t.githubIssueNumber != null && t.githubIssueUrl ? { number: t.githubIssueNumber, url: t.githubIssueUrl } : null,
  };
}

export function toMilestone(
  m: { id: string; title: string; description: string | null; status: MilestoneSummary["status"]; dueOn: Date | null; completedAt: Date | null; position: number },
  counts: { total: number; done: number },
): MilestoneSummary {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    status: m.status,
    dueOn: isoDate(m.dueOn),
    completedAt: iso(m.completedAt),
    position: m.position,
    taskCounts: counts,
  };
}

export function toRelease(
  r: Prisma.ReleaseGetPayload<{ include: { createdBy: { select: typeof userRefSelect } } }>,
): ReleaseItem {
  return {
    id: r.id,
    version: r.version,
    title: r.title,
    notes: r.notes,
    url: r.url,
    commitSha: r.commitSha,
    source: r.source,
    isShip: r.isShip,
    createdBy: r.createdBy ? toUserRef(r.createdBy) : null,
    shippedAt: r.shippedAt.toISOString(),
  };
}

export function toDeployment(d: {
  id: string;
  environment: string;
  state: DeploymentSummary["state"];
  url: string | null;
  sha: string;
  ref: string;
  createdAt: Date;
  updatedAt: Date;
}): DeploymentSummary {
  return {
    id: d.id,
    environment: d.environment,
    state: d.state,
    url: d.url,
    sha: d.sha,
    ref: d.ref,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toContribution(c: {
  commits: number;
  additions: number;
  deletions: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  firstAt: Date | null;
  lastAt: Date | null;
}): ContributionStats {
  return {
    commits: c.commits,
    additions: c.additions,
    deletions: c.deletions,
    prsOpened: c.prsOpened,
    prsMerged: c.prsMerged,
    reviews: c.reviews,
    firstAt: iso(c.firstAt),
    lastAt: iso(c.lastAt),
  };
}

/** Sum several per-repository contribution rows into one. */
export function sumContributions<T extends Parameters<typeof toContribution>[0]>(rows: T[]): ContributionStats | null {
  if (rows.length === 0) return null;
  const acc = rows.reduce(
    (a, c) => ({
      commits: a.commits + c.commits,
      additions: a.additions + c.additions,
      deletions: a.deletions + c.deletions,
      prsOpened: a.prsOpened + c.prsOpened,
      prsMerged: a.prsMerged + c.prsMerged,
      reviews: a.reviews + c.reviews,
      firstAt: !a.firstAt || (c.firstAt && c.firstAt < a.firstAt) ? c.firstAt : a.firstAt,
      lastAt: !a.lastAt || (c.lastAt && c.lastAt > a.lastAt) ? c.lastAt : a.lastAt,
    }),
    { commits: 0, additions: 0, deletions: 0, prsOpened: 0, prsMerged: 0, reviews: 0, firstAt: null as Date | null, lastAt: null as Date | null },
  );
  return toContribution(acc);
}

export const activityInclude = {
  actor: { select: userRefSelect },
  project: { select: { id: true, name: true, slug: true, owner: { select: { username: true } } } },
} satisfies Prisma.ActivityEventInclude;

export type ActivityRow = Prisma.ActivityEventGetPayload<{ include: typeof activityInclude }>;

export function toActivity(e: ActivityRow): ActivityItem {
  return {
    id: e.id,
    type: e.type,
    source: e.source,
    trust: e.trust,
    actor: e.actor ? toUserRef(e.actor) : null,
    actorLogin: e.actorLogin,
    project: { id: e.project.id, name: e.project.name, slug: e.project.slug, ownerUsername: e.project.owner.username },
    payload: (e.payload ?? {}) as Record<string, unknown>,
    occurredAt: e.occurredAt.toISOString(),
  };
}
