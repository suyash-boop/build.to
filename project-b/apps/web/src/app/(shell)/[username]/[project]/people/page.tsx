import type { InvitationItem, JoinRequestItem, MemberItem } from "@bldt/contracts";
import type { Metadata } from "next";
import { PageBody } from "@/components/shell/page";
import { api, getMe } from "@/lib/api.server";
import { can, getProject } from "@/lib/project.server";
import { PeopleManager } from "./people-manager";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/people">): Promise<Metadata> {
  const { username, project } = await params;
  return { title: `People · ${(await getProject(username, project)).name}` };
}

export default async function PeoplePage({ params }: PageProps<"/[username]/[project]/people">) {
  const { username, project } = await params;
  const p = await getProject(username, project);
  const base = `/projects/${p.owner.username}/${p.slug}`;
  const canInvite = can(p, "members.invite");
  const canReview = can(p, "requests.review");
  const [me, members, invitations, requests] = await Promise.all([
    getMe(),
    api<{ items: MemberItem[]; externalContributors: { githubLogin: string; commits: number; prsMerged: number }[] }>(`${base}/members`),
    canInvite ? api<{ items: InvitationItem[] }>(`${base}/invitations`) : Promise.resolve({ items: [] }),
    canReview ? api<{ items: JoinRequestItem[] }>(`${base}/requests`) : Promise.resolve({ items: [] }),
  ]);

  return (
    <PageBody width="medium">
      <PeopleManager
        owner={p.owner.username}
        slug={p.slug}
        viewerId={me?.id ?? null}
        viewerRole={p.viewer.role}
        members={members.items}
        external={members.externalContributors}
        invitations={invitations.items}
        requests={requests.items}
        canInvite={canInvite}
        canManage={can(p, "members.manage")}
        canReview={canReview}
      />
    </PageBody>
  );
}
