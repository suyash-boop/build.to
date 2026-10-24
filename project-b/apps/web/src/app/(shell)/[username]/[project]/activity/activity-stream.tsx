"use client";

import type { ActivityItem, Paginated } from "@bldt/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityFeed } from "@/components/domain/activity";
import { TrustMark } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/choice";
import { Panel } from "@/components/ui/misc";
import { http } from "@/lib/api.client";

const FILTERS = [
  { value: "", label: "All" },
  { value: "github.", label: "Code" },
  { value: "task.", label: "Tasks" },
  { value: "project.", label: "Project" },
  { value: "member.", label: "People" },
] as const;

export function ActivityStream({ owner, slug, initial }: { owner: string; slug: string; initial: Paginated<ActivityItem> }) {
  const [type, setType] = useState<(typeof FILTERS)[number]["value"]>("");
  const q = useInfiniteQuery({
    queryKey: ["activity", owner, slug, type],
    queryFn: ({ pageParam }) =>
      http.get<Paginated<ActivityItem>>(
        `/projects/${owner}/${slug}/activity?limit=40${type ? `&type=${type}` : ""}${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    initialData: type === "" ? { pages: [initial], pageParams: [null] } : undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented size="sm" value={type} onChange={setType} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
        <div className="flex items-center gap-3 text-xs text-faint">
          <span className="flex items-center gap-1.5"><TrustMark trust="CONNECTED" /> Verified from GitHub</span>
        </div>
      </div>
      <Panel className="px-4 py-2">
        {q.isPending ? <p className="py-6 text-center text-sm text-muted">Loading</p> : <ActivityFeed items={items} byDay emptyText="No activity of this kind yet." />}
      </Panel>
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Load older activity
          </Button>
        </div>
      )}
    </div>
  );
}
