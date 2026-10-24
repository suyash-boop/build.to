import "server-only";
import type { ProjectAction, ProjectDetail } from "@bldt/contracts";
import { cache } from "react";
import { notFound } from "next/navigation";
import { apiOr404 } from "./api.server";

/** One fetch per request, shared by the project layout and its pages. */
export const getProject = cache((owner: string, slug: string) =>
  apiOr404<ProjectDetail>(`/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`),
);

export const can = (p: ProjectDetail, action: ProjectAction) => p.viewer.permissions.includes(action);

/** For member-only tabs: outsiders get the same 404 as for a missing page. */
export function requirePermission(p: ProjectDetail, action: ProjectAction) {
  if (!can(p, action)) notFound();
}
