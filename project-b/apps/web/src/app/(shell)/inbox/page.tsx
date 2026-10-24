import type { NotificationItem, Paginated } from "@bldt/contracts";
import type { Metadata } from "next";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { api, requireMe } from "@/lib/api.server";
import { InboxList } from "./inbox-list";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  await requireMe("/inbox");
  const first = await api<Paginated<NotificationItem>>("/notifications?limit=50");
  return (
    <>
      <PageHeader title="Inbox" />
      <MobileTitle>Inbox</MobileTitle>
      <PageBody width="medium">
        <InboxList initial={first} />
      </PageBody>
    </>
  );
}
