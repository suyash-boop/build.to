import { can, type ProjectAction } from "@bldt/contracts";
import type { Db, Project, ProjectRole, User } from "@bldt/db";
import { forbidden, notFound } from "./errors.ts";

export interface ProjectAccess {
  project: Project & { owner: User };
  role: ProjectRole | null;
}

export async function resolveProject(
  db: Db,
  ownerUsername: string,
  slug: string,
  viewer: User | null,
): Promise<ProjectAccess> {
  const project = await db.project.findFirst({
    where: {
      slug: slug.toLowerCase(),
      deletedAt: null,
      owner: { username: ownerUsername.toLowerCase(), deletedAt: null },
    },
    include: { owner: true },
  });
  if (!project) throw notFound("Project not found");

  let role: ProjectRole | null = null;
  if (viewer) {
    const m = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: viewer.id } },
      select: { role: true },
    });
    role = m?.role ?? null;
  }

  // Private projects are indistinguishable from missing ones for outsiders.
  if (!can("project.view", { role, visibility: project.visibility })) throw notFound("Project not found");
  return { project, role };
}

/** Resolve and require a permission. Non-viewable projects 404; viewable but forbidden actions 403. */
export async function authorize(
  db: Db,
  params: { owner: string; slug: string },
  viewer: User | null,
  action: ProjectAction,
): Promise<ProjectAccess> {
  const access = await resolveProject(db, params.owner, params.slug, viewer);
  if (!can(action, { role: access.role, visibility: access.project.visibility })) {
    throw forbidden();
  }
  return access;
}
