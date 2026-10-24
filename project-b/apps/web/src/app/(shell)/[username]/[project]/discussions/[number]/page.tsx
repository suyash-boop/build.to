import type { DiscussionDetail } from "@bldt/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBody } from "@/components/shell/page";
import { apiOr404 } from "@/lib/api.server";
import { getProject, requirePermission } from "@/lib/project.server";
import { DiscussionThread } from "./discussion-thread";

async function load(username: string, project: string, number: string) {
  if (!/^\d{1,9}$/.test(number)) notFound();
  const p = await getProject(username, project);
  requirePermission(p, "tasks.view");
  return { p, d: await apiOr404<DiscussionDetail>(`/projects/${p.owner.username}/${p.slug}/discussions/${number}`) };
}

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/discussions/[number]">): Promise<Metadata> {
  const { username, project, number } = await params;
  const { p, d } = await load(username, project, number);
  return { title: `${d.title} · ${p.name}` };
}

export default async function DiscussionPage({ params }: PageProps<"/[username]/[project]/discussions/[number]">) {
  const { username, project, number } = await params;
  const { p, d } = await load(username, project, number);
  return (
    <PageBody width="medium">
      <DiscussionThread owner={p.owner.username} slug={p.slug} initial={d} />
    </PageBody>
  );
}
