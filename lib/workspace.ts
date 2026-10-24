import { prisma } from "@/lib/prisma";

/** Match B's visibility rules: a profile must not reveal private project names. */
export async function getProfileProjects(userId: string, viewerId?: string) {
  const self = userId === viewerId;
  return prisma.projectMember.findMany({
    where: {
      userId,
      ...(self ? {} : { showOnProfile: true }),
      project: {
        deletedAt: null,
        ...(self ? {} : { OR: [
          { visibility: "PUBLIC" },
          ...(viewerId ? [{ members: { some: { userId: viewerId } } }] : []),
        ] }),
      },
    },
    select: { role: true, project: { select: {
      id: true, name: true, slug: true, tagline: true, stage: true,
      visibility: true, owner: { select: { username: true } },
      _count: { select: { members: true, releases: true } },
    } } },
    orderBy: [{ profileOrder: "asc" }, { joinedAt: "desc" }],
    take: 6,
  });
}
