import type { Db, Prisma } from "@bldt/db";

/** Event types that carry members-only content (task, discussion, and milestone titles). */
const MEMBERS_ONLY_PREFIXES = ["task.", "discussion.", "milestone."];

/**
 * What a non-member may see of a project's activity: no members-only events, and nothing from a
 * private repository (every GitHub event payload records its repository as `repo`).
 */
export async function outsiderActivityFilter(db: Db, projectIds: string[]): Promise<Prisma.ActivityEventWhereInput> {
  const privateRepos = projectIds.length
    ? await db.repository.findMany({
        where: { isPrivate: true, projects: { some: { projectId: { in: projectIds } } } },
        select: { fullName: true },
        take: 500,
      })
    : [];
  return {
    AND: [
      ...MEMBERS_ONLY_PREFIXES.map((p) => ({ NOT: { type: { startsWith: p } } })),
      ...privateRepos.map((r) => ({ NOT: { payload: { path: ["repo"], equals: r.fullName } } })),
    ],
  };
}
