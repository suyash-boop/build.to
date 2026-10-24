import type { ProjectRole, Visibility } from "./enums.ts";

/**
 * Single source of truth for project authorization. The API enforces it; the UI uses it only to
 * hide controls a viewer cannot use.
 */
export type ProjectAction =
  | "project.view"
  | "project.update"
  | "project.visibility"
  | "project.delete"
  | "project.transfer"
  | "project.ship"
  | "project.integrations"
  | "members.view"
  | "members.invite"
  | "members.manage"
  | "requests.review"
  | "tasks.view"
  | "tasks.create"
  | "tasks.update"
  | "tasks.delete"
  | "milestones.manage"
  | "comments.create"
  | "activity.view"
  | "audit.view";

const RANK: Record<ProjectRole, number> = { VIEWER: 1, CONTRIBUTOR: 2, MAINTAINER: 3, OWNER: 4 };

const MIN_ROLE: Record<Exclude<ProjectAction, "project.view">, ProjectRole> = {
  "project.update": "MAINTAINER",
  "project.visibility": "OWNER",
  "project.delete": "OWNER",
  "project.transfer": "OWNER",
  "project.ship": "MAINTAINER",
  "project.integrations": "MAINTAINER",
  "members.view": "VIEWER",
  "members.invite": "MAINTAINER",
  "members.manage": "MAINTAINER",
  "requests.review": "MAINTAINER",
  "tasks.view": "VIEWER",
  "tasks.create": "CONTRIBUTOR",
  "tasks.update": "CONTRIBUTOR",
  "tasks.delete": "MAINTAINER",
  "milestones.manage": "MAINTAINER",
  "comments.create": "CONTRIBUTOR",
  "activity.view": "VIEWER",
  "audit.view": "MAINTAINER",
};

/** Actions an anonymous or non-member viewer may take on a public or unlisted project. */
const PUBLIC_ACTIONS = new Set<ProjectAction>(["project.view", "members.view", "activity.view"]);

export function roleAtLeast(role: ProjectRole | null | undefined, min: ProjectRole): boolean {
  return role != null && RANK[role] >= RANK[min];
}

export function can(
  action: ProjectAction,
  ctx: { role: ProjectRole | null; visibility: Visibility },
): boolean {
  if (ctx.role == null) {
    return ctx.visibility !== "PRIVATE" && PUBLIC_ACTIONS.has(action);
  }
  if (action === "project.view") return true;
  return roleAtLeast(ctx.role, MIN_ROLE[action]);
}

/** A maintainer can manage members strictly below their own rank; only owners touch maintainers. */
export function canAssignRole(actor: ProjectRole, target: ProjectRole): boolean {
  if (target === "OWNER") return false;
  return RANK[actor] > RANK[target];
}

export function permissionsFor(role: ProjectRole | null, visibility: Visibility): ProjectAction[] {
  const all = ["project.view", ...Object.keys(MIN_ROLE)] as ProjectAction[];
  return all.filter((a) => can(a, { role, visibility }));
}
