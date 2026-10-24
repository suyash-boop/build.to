import type { Metadata } from "next";
import { headers } from "next/headers";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { requireMe } from "@/lib/api.server";
import { NewProjectFlow } from "./new-project-flow";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: PageProps<"/new">) {
  const me = await requireMe("/new");
  const sp = await searchParams;
  const host = (await headers()).get("host") ?? "bld.t";
  return (
    <>
      <PageHeader title="New project" />
      <MobileTitle>New project</MobileTitle>
      <PageBody width="medium">
        <NewProjectFlow username={me.username} host={host} githubConnected={Boolean(me.githubLogin)} startBlank={sp.blank === "1"} />
      </PageBody>
    </>
  );
}
