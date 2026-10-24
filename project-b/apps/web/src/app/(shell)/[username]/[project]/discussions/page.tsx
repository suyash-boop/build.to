import type { DiscussionSummary } from "@bldt/contracts";
import type { Metadata } from "next";
import { PageBody } from "@/components/shell/page";
import { api } from "@/lib/api.server";
import { can, getProject, requirePermission } from "@/lib/project.server";
import { DiscussionList } from "./discussion-list";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/discussions">): Promise<Metadata> {
  const { username, project } = await params;
  return { title: `Discussions · ${(await getProject(username, project)).name}` };
}

export default async function DiscussionsPage({ params }: PageProps<"/[username]/[project]/discussions">) {
  const { username, project } = await params;
  const p = await getProject(username, project);
  requirePermission(p, "tasks.view");
  const initial = await api<{ pinned: DiscussionSummary[]; items: DiscussionSummary[]; nextCursor: string | null }>(`/projects/${p.owner.username}/${p.slug}/discussions`);
  return (
    <PageBody width="medium">
      <DiscussionList owner={p.owner.username} slug={p.slug} initial={initial} canPost={can(p, "comments.create")} />
    </PageBody>
  );
}
