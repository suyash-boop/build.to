import type { ActivityItem, Paginated } from "@bldt/contracts";
import type { Metadata } from "next";
import { PageBody } from "@/components/shell/page";
import { api } from "@/lib/api.server";
import { getProject } from "@/lib/project.server";
import { ActivityStream } from "./activity-stream";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/activity">): Promise<Metadata> {
  const { username, project } = await params;
  return { title: `Activity · ${(await getProject(username, project)).name}` };
}

export default async function ActivityPage({ params }: PageProps<"/[username]/[project]/activity">) {
  const { username, project } = await params;
  const p = await getProject(username, project);
  const first = await api<Paginated<ActivityItem>>(`/projects/${p.owner.username}/${p.slug}/activity?limit=40`);
  return (
    <PageBody width="medium">
      <ActivityStream owner={p.owner.username} slug={p.slug} initial={first} />
    </PageBody>
  );
}
