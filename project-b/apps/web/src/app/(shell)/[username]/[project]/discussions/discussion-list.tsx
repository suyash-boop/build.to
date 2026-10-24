"use client";

import type { DiscussionSummary } from "@bldt/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { MessageSquare, Pin, Plus, Search, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORY, CategoryIcon, type Category } from "@/components/domain/discussion";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { LoadError } from "@/components/ui/load-error";
import { Avatar, EmptyState, Panel } from "@/components/ui/misc";
import { http } from "@/lib/api.client";
import { cn } from "@/lib/utils";

type Page = { pinned: DiscussionSummary[]; items: DiscussionSummary[]; nextCursor: string | null };
type Filter = "all" | Category;

export function DiscussionList({ owner, slug, initial, canPost }: { owner: string; slug: string; initial: Page; canPost: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [status, setStatus] = useState<"all" | "open" | "solved">("all");
  const [q, setQ] = useState("");
  // Debounced so typing a word is one request, not one per keystroke.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const base = `/${owner}/${slug}/discussions`;

  const params = new URLSearchParams();
  if (filter !== "all") params.set("category", filter);
  if (filter === "HELP" && status !== "all") params.set("status", status);
  if (query) params.set("q", query);
  const pristine = params.size === 0;

  const list = useInfiniteQuery({
    queryKey: ["discussions", owner, slug, params.toString()],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params);
      if (pageParam) p.set("cursor", pageParam);
      return http.get<Page>(`/projects/${owner}/${slug}/discussions?${p}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
    initialData: pristine ? { pages: [initial], pageParams: [null] } : undefined,
  });
  const pinned = list.data?.pages[0]?.pinned ?? [];
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">Discussions</h1>
          <p className="mt-0.5 text-sm text-muted">Questions, errors, ideas, and updates. Help threads remember what fixed an error.</p>
        </div>
        {canPost && (
          <Button asChild variant="primary">
            <Link href={`${base}/new`}>
              <Plus className="size-3.5" /> New discussion
            </Link>
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setStatus("all");
          }}
          options={[{ value: "all", label: "All" }, ...(Object.keys(CATEGORY) as Category[]).map((c) => ({ value: c, label: CATEGORY[c].label }))]}
        />
        {filter === "HELP" && (
          <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: "all", label: "Any" }, { value: "open", label: "Unsolved" }, { value: "solved", label: "Solved" }]} />
        )}
        <div className="ml-auto w-full sm:w-64">
          <Input leading={<Search className="size-3.5" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, text, errors" aria-label="Search discussions" />
        </div>
      </div>

      {pinned.length > 0 && (
        <Panel className="mb-3 divide-y divide-border overflow-hidden">
          {pinned.map((d) => (
            <Row key={d.id} d={d} href={`${base}/${d.number}`} pinned />
          ))}
        </Panel>
      )}

      {list.isError && items.length === 0 ? (
        <LoadError title="Could not load discussions" error={list.error} onRetry={() => list.refetch()} retrying={list.isRefetching} className="rounded-lg border border-border py-10" />
      ) : items.length === 0 && list.isPending ? (
        <p className="py-10 text-center text-sm text-faint">Loading</p>
      ) : items.length === 0 && !list.isFetching ? (
        <EmptyState icon={<MessageSquare className="size-5" />} title={pristine ? "No discussions yet" : "Nothing matches"}>
          {pristine ? "Start one to ask for help, share an idea, or post an update. From VS Code, right-click an error and choose Ask the team." : "Try another category or search."}
        </EmptyState>
      ) : (
        <Panel className={cn("divide-y divide-border overflow-hidden transition-opacity", list.isFetching && !list.isFetchingNextPage && "opacity-70")}>
          {items.map((d) => (
            <Row key={d.id} d={d} href={`${base}/${d.number}`} />
          ))}
        </Panel>
      )}
      {list.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            Older discussions
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ d, href, pinned }: { d: DiscussionSummary; href: string; pinned?: boolean }) {
  return (
    <Link href={href} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover">
      <CategoryIcon category={d.category} solved={d.solved} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {pinned && <Pin className="size-3 shrink-0 text-faint" aria-label="Pinned" />}
          {d.locked && <Lock className="size-3 shrink-0 text-faint" aria-label="Locked" />}
          <span className="truncate">{d.title}</span>
        </p>
        {d.errorHeadline ? (
          <p className="mt-0.5 truncate font-mono text-2xs text-muted">
            {d.errorHeadline}
            {d.filePath && <span className="text-faint"> · {d.filePath}</span>}
          </p>
        ) : d.excerpt ? (
          <p className="mt-0.5 truncate text-xs text-muted">{d.excerpt}</p>
        ) : null}
        <p className="mt-1 flex items-center gap-1.5 text-2xs text-faint">
          <Avatar user={d.author} size={14} /> {d.author.displayName} · #{d.number} · <RelativeTime iso={d.lastActivityAt} />
          {d.solved && <span className="text-success"> · Solved</span>}
        </p>
      </div>
      {d.replyCount > 0 && (
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-faint tnum">
          <MessageSquare className="size-3" /> {d.replyCount}
        </span>
      )}
    </Link>
  );
}
