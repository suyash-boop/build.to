import type { MatchReason, PersonCard, PersonTech, TechnologyRef } from "@bldt/contracts";
import type { Db, Prisma } from "@bldt/db";

/**
 * Only public projects that the member shows on their profile feed discovery and matching.
 * Private, unlisted, and hidden work never influences who gets suggested to whom.
 */
export const publicMembership = {
  showOnProfile: true,
  project: { deletedAt: null, visibility: "PUBLIC" },
} satisfies Prisma.ProjectMemberWhereInput;

const CATEGORY_ORDER = { LANGUAGE: 0, FRAMEWORK: 1, DATABASE: 2, INFRASTRUCTURE: 3, TOOL: 4 } as const;

/** Build person cards for a set of users from their public work. Order of `userIds` is preserved. */
export async function personCards(db: Db, userIds: string[]): Promise<PersonCard[]> {
  if (userIds.length === 0) return [];
  const [users, memberships, contributions] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds }, deletedAt: null },
      select: { id: true, username: true, displayName: true, avatarUrl: true, headline: true, location: true, openToWork: true, focusAreas: true },
    }),
    db.projectMember.findMany({
      where: { userId: { in: userIds }, ...publicMembership },
      select: {
        userId: true,
        projectId: true,
        project: {
          select: {
            shippedAt: true,
            technologies: { where: { hidden: false }, select: { technology: { select: { slug: true, name: true, category: true, color: true } } } },
          },
        },
      },
    }),
    db.contribution.findMany({
      where: { userId: { in: userIds }, project: { deletedAt: null, visibility: "PUBLIC" } },
      select: { userId: true, projectId: true, commits: true, prsMerged: true },
    }),
  ]);

  const evidencedProjects = new Set(
    contributions.filter((c) => c.commits > 0 || c.prsMerged > 0).map((c) => `${c.userId}:${c.projectId}`),
  );
  const byUser = new Map(users.map((u) => [u.id, u]));

  return userIds
    .map((id) => byUser.get(id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => {
      const mine = memberships.filter((m) => m.userId === u.id);
      const techs = new Map<string, PersonTech>();
      for (const m of mine) {
        const evidenced = evidencedProjects.has(`${u.id}:${m.projectId}`);
        for (const { technology: t } of m.project.technologies) {
          const cur = techs.get(t.slug) ?? { ...t, projects: 0, evidenced: false };
          cur.projects += 1;
          cur.evidenced ||= evidenced;
          techs.set(t.slug, cur);
        }
      }
      const visible = new Set(mine.map((m) => m.projectId));
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        headline: u.headline,
        location: u.location,
        openToWork: u.openToWork,
        focusAreas: u.focusAreas,
        technologies: [...techs.values()].sort(
          (a, b) => Number(b.evidenced) - Number(a.evidenced) || b.projects - a.projects || CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category],
        ),
        publicProjects: mine.length,
        shipped: mine.filter((m) => m.project.shippedAt).length,
        mergedPrs: contributions.filter((c) => c.userId === u.id && visible.has(c.projectId)).reduce((a, c) => a + c.prsMerged, 0),
      };
    });
}

/**
 * Overlap between what someone has worked with and what a project needs. Evidenced technologies
 * count double: shipping code in a stack matters more than being on a team that used it.
 * Languages and frameworks weigh more than tooling, which nearly every project shares.
 */
export function matchScore(person: Map<string, { evidenced: boolean }>, project: TechnologyRef[]): { score: number; reason: MatchReason } {
  const weight = { LANGUAGE: 3, FRAMEWORK: 3, DATABASE: 2, INFRASTRUCTURE: 1, TOOL: 1 } as const;
  const matched: TechnologyRef[] = [];
  let score = 0;
  let evidenced = 0;
  for (const t of project) {
    const p = person.get(t.slug);
    if (!p) continue;
    matched.push(t);
    score += weight[t.category] * (p.evidenced ? 2 : 1);
    if (p.evidenced) evidenced++;
  }
  return { score, reason: { technologies: matched, evidenced } };
}
