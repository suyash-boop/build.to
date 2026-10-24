import type { Metadata } from "next";
import type { Paginated, PersonCard } from "@bldt/contracts";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { api } from "@/lib/api.server";
import { DiscoverTabs } from "../discover-tabs";
import type { DiscoverTech } from "../discover-view";
import { PeopleView } from "./people-view";

export const metadata: Metadata = {
  title: "Discover people",
  description: "Builders on bld.t, what they ship with, and who is open to work.",
};

export default async function DiscoverPeoplePage({ searchParams }: PageProps<"/discover/people">) {
  const sp = await searchParams;
  // Sanitize to what the API accepts so an odd URL never turns into a 400.
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = (str("q") ?? "").slice(0, 100);
  const tech = (str("tech") ?? "").slice(0, 40) || null;
  const open = str("open") === "true" ? "true" : str("open") === "false" ? "false" : null;
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (tech) qs.set("tech", tech);
  if (open) qs.set("open", open);
  qs.set("limit", "24");
  const [people, techs] = await Promise.all([
    api<Paginated<PersonCard>>(`/discover/people?${qs.toString()}`),
    api<{ items: DiscoverTech[] }>("/discover/technologies"),
  ]);
  return (
    <>
      <PageHeader title="Discover" />
      <MobileTitle>Discover</MobileTitle>
      <PageBody>
        <DiscoverTabs />
        <PeopleView
          initial={people}
          technologies={techs.items}
          params={{ q, tech, open: open === "true" }}
        />
      </PageBody>
    </>
  );
}
