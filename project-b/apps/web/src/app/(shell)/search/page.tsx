import type { Metadata } from "next";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { requireMe } from "@/lib/api.server";
import { SearchView } from "./search-view";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q, type, project } = await searchParams;
  const query = typeof q === "string" ? q : "";
  await requireMe(`/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  return (
    <>
      <PageHeader title="Search" />
      <MobileTitle>Search</MobileTitle>
      <PageBody width="medium">
        <SearchView initialQuery={query} initialType={typeof type === "string" ? type : null} project={typeof project === "string" ? project : null} />
      </PageBody>
    </>
  );
}
