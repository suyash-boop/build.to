"use client";

import type { ChangelogDto } from "@bldt/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { Spinner } from "@/components/ui/spinner";
import { http } from "@/lib/api.client";
import { cn, plural } from "@/lib/utils";

/** What merged since the last release. Rendered from data the server already fetched. */
export function UnreleasedChanges({ changelog }: { changelog: ChangelogDto }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-xs text-muted">
          {changelog.range.fromLabel ? `Since ${changelog.range.fromLabel}` : "Since the project started"} · {summary(changelog)}
        </p>
        <CopyMarkdown markdown={changelog.markdown} />
      </div>
      <ChangelogBody changelog={changelog} />
    </div>
  );
}

/** The changes a release contains, loaded when someone opens it. */
export function ReleaseChanges({ api, releaseId }: { api: string; releaseId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["changelog", api, releaseId],
    queryFn: () => http.get<ChangelogDto>(`${api}/changelog?release=${encodeURIComponent(releaseId)}`),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-sm text-xs text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
          Merged work in this release
          {q.data && <span className="text-faint">· {summary(q.data)}</span>}
        </button>
        {open && q.data && q.data.sections.length > 0 && <CopyMarkdown markdown={q.data.markdown} />}
      </div>
      {open &&
        (q.isPending ? (
          <div className="flex justify-center px-4 pb-4">
            <Spinner />
          </div>
        ) : q.isError ? (
          <div className="px-4 pb-4">
            <LoadError onRetry={() => void q.refetch()} />
          </div>
        ) : q.data.sections.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-faint">No pull requests merged between the previous release and this one.</p>
        ) : (
          <ChangelogBody changelog={q.data} />
        ))}
    </div>
  );
}

function ChangelogBody({ changelog }: { changelog: ChangelogDto }) {
  return (
    <div className="space-y-4 px-4 pb-4">
      {changelog.sections.map((s) => (
        <section key={s.kind}>
          <h4 className="text-xs font-medium text-faint">{s.title}</h4>
          <ul className="mt-1.5 space-y-1">
            {s.items.map((i, n) => (
              <li key={i.pr ? `${i.pr.repo}#${i.pr.number}` : `${s.kind}-${n}`} className="flex gap-2 text-sm leading-6">
                <span className="min-w-0 flex-1">
                  {i.scope && <span className="font-medium">{i.scope}: </span>}
                  {i.text}
                  {i.tasks.length > 0 && <span className="ml-1.5 font-mono text-xs text-faint">{i.tasks.join(", ")}</span>}
                </span>
                {i.pr && (
                  <a href={i.pr.url} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-xs leading-6 text-muted hover:text-fg">
                    #{i.pr.number}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {changelog.contributors.length > 0 && (
        <p className="text-xs text-muted">
          <span className="text-faint">Contributors: </span>
          {changelog.contributors.join(", ")}
        </p>
      )}
      {changelog.truncated && <p className="text-xs text-faint">Only the most recent merged pull requests are listed.</p>}
    </div>
  );
}

function summary(c: ChangelogDto) {
  const parts = [plural(c.stats.pullRequests, "pull request")];
  if (c.stats.tasks) parts.push(plural(c.stats.tasks, "task"));
  if (c.stats.contributors) parts.push(plural(c.stats.contributors, "contributor"));
  return parts.join(", ");
}

function CopyMarkdown({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(markdown);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy. Your browser blocked clipboard access.");
        }
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy as Markdown"}
    </Button>
  );
}
