import type { SidebarProject, WorkRecordItem } from "@bldt/contracts";
import type { Metadata } from "next";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { api, requireMe } from "@/lib/api.server";
import { AccountSettings, type SessionRow } from "./account-settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireMe("/settings");
  const [projects, sessions, records] = await Promise.all([
    api<{ items: SidebarProject[] }>("/me/projects"),
    api<{ items: SessionRow[] }>("/me/sessions"),
    api<{ items: WorkRecordItem[]; enabled: boolean }>("/me/work-records"),
  ]);
  return (
    <>
      <PageHeader title="Settings" />
      <MobileTitle>Settings</MobileTitle>
      <PageBody width="narrow">
        <AccountSettings me={me} projects={projects.items} sessions={sessions.items} records={records} extensionPublished={process.env.VSCODE_EXTENSION_PUBLISHED === "true"} />
      </PageBody>
    </>
  );
}
