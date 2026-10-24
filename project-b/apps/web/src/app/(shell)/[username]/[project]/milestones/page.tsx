import type { MilestoneSummary } from "@bldt/contracts";
import type { Metadata } from "next";
import { PageBody } from "@/components/shell/page";
import { api } from "@/lib/api.server";
import { can, getProject, requirePermission } from "@/lib/project.server";
import { MilestoneList } from "./milestone-list";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/milestones">): Promise<Metadata> {
  const { username, project } = await params;
  return { title: `Milestones · ${(await getProject(username, project)).name}` };
}

export default async function MilestonesPage({ params }: PageProps<"/[username]/[project]/milestones">) {
  const { username, project } = await params;
  const p = await getProject(username, project);
  requirePermission(p, "tasks.view");
  const { items } = await api<{ items: MilestoneSummary[] }>(`/projects/${p.owner.username}/${p.slug}/milestones`);
  return (
    <PageBody width="medium">
      <MilestoneList owner={p.owner.username} slug={p.slug} initial={items} canManage={can(p, "milestones.manage")} />
    </PageBody>
  );
}
