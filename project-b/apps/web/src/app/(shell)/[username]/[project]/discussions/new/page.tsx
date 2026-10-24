import type { Metadata } from "next";
import { PageBody } from "@/components/shell/page";
import { can, getProject, requirePermission } from "@/lib/project.server";
import { NewDiscussion } from "./new-discussion";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/discussions/new">): Promise<Metadata> {
  const { username, project } = await params;
  return { title: `New discussion · ${(await getProject(username, project)).name}` };
}

export default async function NewDiscussionPage({ params, searchParams }: PageProps<"/[username]/[project]/discussions/new">) {
  const { username, project } = await params;
  const { category } = await searchParams;
  const p = await getProject(username, project);
  requirePermission(p, "comments.create");
  return (
    <PageBody width="medium">
      <NewDiscussion owner={p.owner.username} slug={p.slug} canAnnounce={can(p, "project.update")} initialCategory={category === "HELP" ? "HELP" : "GENERAL"} />
    </PageBody>
  );
}
