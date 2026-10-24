"use client";

import type { Paginated, PersonCard } from "@bldt/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, Users, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PersonCardView } from "@/components/domain/match";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { http } from "@/lib/api.client";
import { cn } from "@/lib/utils";
import type { DiscoverTech } from "../discover-view";

interface Params {
  q: string;
  tech: string | null;
  open: boolean;
}

export function PeopleView({ initial, technologies, params }: { initial: Paginated<PersonCard>; technologies: DiscoverTech[]; params: Params }) {
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
    const s = sp.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

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
  qs.set("limit", "24");

  const feed = useInfiniteQuery({
    queryKey: ["discover-people", qs.toString()],
    queryFn: ({ pageParam }) => http.get<Paginated<PersonCard>>(`/discover/people?${qs.toString()}${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
    initialData: { pages: [initial], pageParams: [null] },
  });
  const items = feed.data.pages.flatMap((p) => p.items);
  const filtered = Boolean(params.q || params.tech || params.open);

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        People with public projects on bld.t. Technologies in darker chips are backed by their own commits or merged pull requests.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-72">
          <Input value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Name, headline, or focus area" leading={<Search className="mr-2 size-3.5" />} aria-label="Search people" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <Switch checked={params.open} onChange={(open) => go({ open })} label="Open to work" /> Open to work
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
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title={filtered ? "Nobody matches yet" : "No public builders yet"}>
            {filtered ? "Try another technology or clear the filters." : "People appear here once they have a public project or mark themselves open to work."}
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((p) => (
              <PersonCardView key={p.id} p={p} />
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
