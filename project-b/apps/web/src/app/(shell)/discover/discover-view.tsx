"use client";

import type { Paginated, ProjectCard, TechCategory } from "@bldt/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Compass, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StageBadge, TechChip } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Segmented, Switch } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { AvatarStack, EmptyState } from "@/components/ui/misc";
import { http } from "@/lib/api.client";
import { cn, shortDate } from "@/lib/utils";

export interface DiscoverTech {
  slug: string;
  name: string;
  category: TechCategory;
  color: string | null;
  projects: number;
}

interface Params {
  q: string;
  tech: string | null;
  open: boolean;
  sort: "recent" | "shipped";
}

export function DiscoverView({ initial, technologies, params }: { initial: Paginated<ProjectCard>; technologies: DiscoverTech[]; params: Params }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.q);
  // The view is no longer remounted per query, so follow URL changes made
  // elsewhere (back/forward, Clear) without clobbering text typed meanwhile.
  const pushed = useRef(params.q);
  useEffect(() => {
    if (params.q !== pushed.current) {
      pushed.current = params.q;
      setQ(params.q);
    }
  }, [params.q]);

  const go = (next: Partial<Params>) => {
    const p = { ...params, ...next };
    const sp = new URLSearchParams();
    if (p.q) sp.set("q", p.q);
    pushed.current = p.q;
    if (p.tech) sp.set("tech", p.tech);
    if (p.open) sp.set("open", "true");
    if (p.sort === "shipped") sp.set("sort", "shipped");
    const s = sp.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  // Debounced search that updates the URL, so results are shareable.
  useEffect(() => {
    if (q === params.q) return;
    const t = setTimeout(() => go({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.tech) qs.set("tech", params.tech);
  if (params.open) qs.set("open", "true");
  if (params.sort === "shipped") qs.set("sort", "shipped");
  qs.set("limit", "24");

  const feed = useInfiniteQuery({
    queryKey: ["discover", qs.toString()],
    queryFn: ({ pageParam }) => http.get<Paginated<ProjectCard>>(`/discover/projects?${qs.toString()}${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
    initialData: { pages: [initial], pageParams: [null] },
  });
  const items = feed.data.pages.flatMap((p) => p.items);
  const filtered = Boolean(params.q || params.tech || params.open);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Public projects</h2>
        <p className="mt-0.5 text-sm text-muted">What people are building, what it is built with, and who is looking for help.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-72">
          <Input value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or description" leading={<Search className="mr-2 size-3.5" />} aria-label="Search projects" />
        </div>
        <Segmented size="sm" value={params.sort} onChange={(sort) => go({ sort })} options={[{ value: "recent", label: "Recently active" }, { value: "shipped", label: "Recently shipped" }]} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <Switch checked={params.open} onChange={(open) => go({ open })} label="Looking for contributors" /> Looking for contributors
        </label>
        {filtered && (
          <Button size="sm" variant="ghost" onClick={() => { setQ(""); router.replace(pathname, { scroll: false }); }}>
            <X className="size-3.5" /> Clear
          </Button>
        )}
      </div>

      {technologies.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by technology">
          {technologies.map((t) => {
            const active = params.tech === t.slug;
            return (
              <button
                key={t.slug}
                onClick={() => go({ tech: active ? null : t.slug })}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-xs transition-colors",
                  active ? "border-fg bg-fg text-bg" : "border-border text-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {t.color && <span className="size-2 rounded-full" style={{ background: t.color }} aria-hidden />}
                {t.name}
                <span className={cn("tnum", active ? "text-bg/70" : "text-faint")}>{t.projects}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState icon={<Compass className="size-5" />} title={filtered ? "No projects match" : "No public projects yet"}>
            {filtered ? "Try a different technology or search." : "Public projects show up here as soon as someone makes one."}
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((p) => (
              <Link key={p.id} href={`/${p.owner.username}/${p.slug}`} className="flex flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="truncate text-2xs text-faint">by {p.owner.displayName}</p>
                  </div>
                  <StageBadge stage={p.stage} />
                </div>
                {p.tagline && <p className="mt-2 line-clamp-2 text-sm text-muted">{p.tagline}</p>}
                {p.openToContributors && p.lookingFor.length > 0 && (
                  <p className="mt-2 text-xs text-muted">Looking for {p.lookingFor.slice(0, 3).join(", ")}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.technologies.slice(0, 4).map((t) => (
                    <TechChip key={t.slug} tech={t} />
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between pt-4 text-xs text-faint">
                  <span className="tnum">{p.shippedAt ? `Shipped ${shortDate(p.shippedAt)}` : `Active ${shortDate(p.updatedAt)}`}</span>
                  <AvatarStack users={p.members} max={4} size={18} />
                </div>
              </Link>
            ))}
          </div>
        )}
        {feed.hasNextPage && (
          <div className="mt-6 flex justify-center">
            <Button size="sm" loading={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>Load more</Button>
          </div>
        )}
      </div>
    </div>
  );
}
