import type { Paginated, ProjectCard, SuggestedProject } from "@bldt/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { MatchLine } from "@/components/domain/match";
import { StageBadge, TechChip } from "@/components/domain/status";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { SectionHeader } from "@/components/ui/misc";
import { api, getMe } from "@/lib/api.server";
import { DiscoverTabs } from "./discover-tabs";
import { DiscoverView, type DiscoverTech } from "./discover-view";

export const metadata: Metadata = {
  title: "Discover projects",
  description: "Public projects on bld.t, what they are built with, and which ones are looking for contributors.",
};

export default async function DiscoverPage({ searchParams }: PageProps<"/discover">) {
  const sp = await searchParams;
  // Sanitize to what the API accepts so an odd URL never turns into a 400.
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = (str("q") ?? "").slice(0, 100);
  const tech = (str("tech") ?? "").slice(0, 40) || null;
  const open = str("open") === "true" ? "true" : str("open") === "false" ? "false" : null;
  const sort = str("sort") === "shipped" ? "shipped" : "recent";
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (tech) qs.set("tech", tech);
  if (open) qs.set("open", open);
  if (sort === "shipped") qs.set("sort", sort);
  qs.set("limit", "24");
  const me = await getMe();
  const filtered = qs.has("q") || qs.has("tech") || qs.has("open");
  const [projects, techs, suggestions] = await Promise.all([
    api<Paginated<ProjectCard>>(`/discover/projects?${qs.toString()}`),
    api<{ items: DiscoverTech[] }>("/discover/technologies"),
    me && !filtered ? api<{ items: SuggestedProject[] }>("/discover/suggestions") : Promise.resolve({ items: [] as SuggestedProject[] }),
  ]);

  return (
    <>
      <PageHeader title="Discover" />
      <MobileTitle>Discover</MobileTitle>
      <PageBody>
        <DiscoverTabs />
        {suggestions.items.length > 0 && (
          <section className="mb-10">
            <SectionHeader title="Fits your stack" />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {suggestions.items.map((p) => (
                <Link
                  key={p.id}
                  href={`/${p.owner.username}/${p.slug}`}
                  className="flex flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="truncate text-2xs text-faint">by {p.owner.displayName}</p>
                    </div>
                    <StageBadge stage={p.stage} />
                  </div>
                  {p.tagline && <p className="mt-2 line-clamp-2 text-sm text-muted">{p.tagline}</p>}
                  {p.lookingFor.length > 0 && <p className="mt-2 text-xs text-muted">Looking for {p.lookingFor.slice(0, 3).join(", ")}</p>}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {p.technologies.slice(0, 4).map((t) => (
                      <TechChip key={t.slug} tech={t} />
                    ))}
                  </div>
                  <div className="mt-auto pt-3">
                    <MatchLine reason={p.reason} subject="your" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
        <DiscoverView
          initial={projects}
          technologies={techs.items}
          params={{ q, tech, open: open === "true", sort }}
        />
      </PageBody>
    </>
  );
}
