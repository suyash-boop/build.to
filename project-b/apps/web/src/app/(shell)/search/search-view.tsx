"use client";

import type { FullSearchResults, Highlight } from "@bldt/contracts";
import { useQuery } from "@tanstack/react-query";
import { GitMerge, GitPullRequest, GitPullRequestClosed, Search, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useState } from "react";
import { CategoryIcon } from "@/components/domain/discussion";
import { StatusIcon } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { http } from "@/lib/api.client";
import { shortDate } from "@/lib/utils";

type Type = "all" | "tasks" | "discussions" | "pull_requests" | "releases";
const TYPES: { value: Type; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tasks", label: "Tasks" },
  { value: "discussions", label: "Discussions" },
  { value: "pull_requests", label: "Pull requests" },
  { value: "releases", label: "Releases" },
];

/** Matched words in <mark>, as text nodes: highlights never involve HTML. */
function Marked({ parts, className }: { parts: Highlight; className?: string }) {
  if (parts.length === 0) return null;
  return (
    <p className={className}>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className="rounded-sm bg-accent/20 px-0.5 text-fg">{p}</mark> : <span key={i}>{p}</span>))}
    </p>
  );
}

export function SearchView({ initialQuery, initialType, project }: { initialQuery: string; initialType: string | null; project: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [type, setType] = useState<Type>(TYPES.some((t) => t.value === initialType) ? (initialType as Type) : "all");
  const [page, setPage] = useState(1);
  const query = useDeferredValue(q.trim());

  // Keep the URL shareable without adding history entries per keystroke.
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (type !== "all") params.set("type", type);
    if (project) params.set("project", project);
    router.replace(`/search${params.size ? `?${params}` : ""}`, { scroll: false });
    setPage(1);
  }, [query, type, project, router]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["search-full", query, type, project, page],
    queryFn: () => {
      const params = new URLSearchParams({ q: query, page: String(page) });
      if (type !== "all") params.set("type", type);
      if (project) params.set("project", project);
      return http.get<FullSearchResults>(`/search/full?${params}`);
    },
    enabled: query.length > 0,
    placeholderData: (prev) => prev,
  });

  const total = data ? data.tasks.length + data.discussions.length + data.pullRequests.length + data.releases.length : 0;
  const section = (t: Type) => type === "all" || type === t;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Input
          leading={<Search className="size-4" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tasks, discussions, errors, pull requests, releases"
          autoFocus
          aria-label="Search"
          className="h-11 text-base"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented size="sm" value={type} onChange={setType} options={TYPES} />
          {project && (
            <span className="text-xs text-muted">
              In <span className="font-mono">{project}</span> ·{" "}
              <Link href={`/search?q=${encodeURIComponent(query)}`} className="underline underline-offset-2 hover:text-fg">
                search everywhere
              </Link>
            </span>
          )}
        </div>
      </div>

      {!query ? (
        <p className="text-sm text-muted">Words match in any form (&ldquo;crashing&rdquo; finds &ldquo;crash&rdquo;), and the last word matches as you type. Error messages in help threads are searchable too.</p>
      ) : isError ? (
        <p className="text-sm text-danger">Search failed. Try again in a moment.</p>
      ) : data && total === 0 && !isFetching ? (
        <EmptyState icon={<Search className="size-5" />} title={`Nothing matches “${query}”`}>
          Try fewer or different words. Only projects you are a member of are searched, plus public releases.
        </EmptyState>
      ) : data ? (
        <div className={isFetching ? "space-y-8 opacity-70 transition-opacity" : "space-y-8 transition-opacity"}>
          {section("tasks") && data.tasks.length > 0 && (
            <Section title="Tasks" more={type === "all" && data.tasks.length >= 6 ? () => setType("tasks") : undefined}>
              {data.tasks.map((t) => (
                <Row key={`${t.project.ownerUsername}/${t.project.slug}/${t.number}`} href={`/${t.project.ownerUsername}/${t.project.slug}/tasks?task=${t.number}`}>
                  <StatusIcon status={t.status} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="mr-2 font-mono text-xs text-faint">{t.identifier}</span>
                      {t.title}
                    </p>
                    <Marked parts={t.snippet} className="mt-1 line-clamp-2 text-xs text-muted" />
                  </div>
                  <span className="shrink-0 text-xs text-faint">{t.project.name}</span>
                </Row>
              ))}
            </Section>
          )}
          {section("discussions") && data.discussions.length > 0 && (
            <Section title="Discussions" more={type === "all" && data.discussions.length >= 6 ? () => setType("discussions") : undefined}>
              {data.discussions.map((d) => (
                <Row key={`${d.project.ownerUsername}/${d.project.slug}#${d.number}`} href={`/${d.project.ownerUsername}/${d.project.slug}/discussions/${d.number}`}>
                  <CategoryIcon category={d.category} solved={d.solved} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{d.title}</p>
                    <Marked parts={d.snippet} className="mt-1 line-clamp-2 text-xs text-muted" />
                    {d.inReply && <p className="mt-0.5 text-2xs text-faint">Matched in a reply</p>}
                  </div>
                  <span className="shrink-0 text-xs text-faint">{d.project.name}</span>
                </Row>
              ))}
            </Section>
          )}
          {section("pull_requests") && data.pullRequests.length > 0 && (
            <Section title="Pull requests" more={type === "all" && data.pullRequests.length >= 6 ? () => setType("pull_requests") : undefined}>
              {data.pullRequests.map((pr) => (
                <Row key={pr.url} href={pr.url} external>
                  {pr.state === "MERGED" ? <GitMerge className="mt-0.5 size-4 shrink-0 text-st-shipped" /> : pr.state === "CLOSED" ? <GitPullRequestClosed className="mt-0.5 size-4 shrink-0 text-faint" /> : <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{pr.title}</p>
                    <p className="mt-0.5 font-mono text-2xs text-faint">
                      {pr.repo}#{pr.number}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-faint">{pr.project.name}</span>
                </Row>
              ))}
            </Section>
          )}
          {section("releases") && data.releases.length > 0 && (
            <Section title="Releases" more={type === "all" && data.releases.length >= 6 ? () => setType("releases") : undefined}>
              {data.releases.map((r) => (
                <Row key={r.id} href={`/${r.project.ownerUsername}/${r.project.slug}/releases`}>
                  <Tag className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {r.title}
                      {r.version && <span className="ml-2 font-mono text-xs text-faint">{r.version}</span>}
                    </p>
                    <Marked parts={r.snippet} className="mt-1 line-clamp-2 text-xs text-muted" />
                  </div>
                  <span className="shrink-0 text-xs text-faint">
                    {r.project.name} · {shortDate(r.shippedAt)}
                  </span>
                </Row>
              ))}
            </Section>
          )}
          {type !== "all" && (page > 1 || data.hasMore) && (
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="ghost" disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, more, children }: { title: string; more?: () => void; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {more && (
          <button type="button" onClick={more} className="text-xs text-muted hover:text-fg">
            See all
          </button>
        )}
      </div>
      <div className="divide-y divide-border border-y border-border">{children}</div>
    </section>
  );
}

function Row({ href, external, children }: { href: string; external?: boolean; children: React.ReactNode }) {
  const cls = "flex items-start gap-3 px-1 py-3 transition-colors hover:bg-surface-hover";
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
