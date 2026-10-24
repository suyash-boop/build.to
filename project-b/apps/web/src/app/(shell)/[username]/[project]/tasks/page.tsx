import type { MemberItem, MilestoneSummary, TaskSummary } from "@bldt/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { api, getMe } from "@/lib/api.server";
import { can, getProject, requirePermission } from "@/lib/project.server";
import { TaskBoard } from "./task-board";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/tasks">): Promise<Metadata> {
  const { username, project } = await params;
  const p = await getProject(username, project);
  return { title: `Tasks · ${p.name}` };
}

export default async function TasksPage({ params }: PageProps<"/[username]/[project]/tasks">) {
  const { username, project } = await params;
  const p = await getProject(username, project);
  requirePermission(p, "tasks.view");
  const base = `/projects/${p.owner.username}/${p.slug}`;
  const [me, tasks, members, milestones] = await Promise.all([
    getMe(),
    api<{ items: TaskSummary[] }>(`${base}/tasks`),
    api<{ items: MemberItem[] }>(`${base}/members`),
    api<{ items: MilestoneSummary[] }>(`${base}/milestones`),
  ]);

  return (
    <Suspense>
      <TaskBoard
        project={{ owner: p.owner.username, slug: p.slug, key: p.key }}
        initialTasks={tasks.items}
        initialMembers={members.items}
        initialMilestones={milestones.items}
        canEdit={can(p, "tasks.update")}
        canCreate={can(p, "tasks.create")}
        viewerId={me!.id}
      />
    </Suspense>
  );
}
