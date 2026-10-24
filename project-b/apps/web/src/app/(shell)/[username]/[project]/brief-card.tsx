"use client";

import type { ProjectBriefItem } from "@bldt/contracts";
import { RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/misc";
import { errorMessage, http } from "@/lib/api.client";

/**
 * Generated status brief. Clearly labelled as generated, never presented as verified fact,
 * and every reference links to the task it came from.
 */
export function BriefCard({
  owner,
  slug,
  initial,
  canGenerate,
}: {
  owner: string;
  slug: string;
  initial: ProjectBriefItem | null;
  canGenerate: boolean;
}) {
  const [brief, setBrief] = useState(initial);
  const [busy, setBusy] = useState(false);
  const base = `/${owner}/${slug}`;

  const generate = async () => {
    setBusy(true);
    try {
      const res = await http.post<{ brief: ProjectBriefItem }>(`/projects/${owner}/${slug}/brief`);
      setBrief(res.brief);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const ref = (r: string): ReactNode => {
    const task = /^[A-Z][A-Z0-9]*-(\d+)$/.exec(r);
    if (task) {
      return (
        <Link key={r} href={`${base}/tasks?task=${task[1]}`} className="font-mono text-2xs text-faint hover:text-fg hover:underline">
          {r}
        </Link>
      );
    }
    return (
      <span key={r} className="font-mono text-2xs text-faint">
        {r}
      </span>
    );
  };

  const list = (title: string, items: ProjectBriefItem["recent"]) =>
    items.length > 0 && (
      <div>
        <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-faint">{title}</p>
        <ul className="space-y-1.5">
          {items.map((b, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-border-strong" aria-hidden />
              <span className="min-w-0">
                {b.text}
                {b.refs.length > 0 && <span className="ml-1.5 inline-flex flex-wrap gap-1.5 align-baseline">{b.refs.map(ref)}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  if (!brief) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-4 text-faint" />
          <div>
            <p className="text-sm font-medium">Status brief</p>
            <p className="text-xs text-muted">A short summary of where the project stands, written from its tasks, milestones, pull requests, and README.</p>
          </div>
        </div>
        {canGenerate && (
          <Button size="sm" loading={busy} onClick={generate}>
            Generate brief
          </Button>
        )}
      </Panel>
    );
  }

  return (
    <Panel className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wide text-faint">
          <Sparkles className="size-3.5" /> Status brief
        </p>
        {canGenerate && (
          <Button size="xs" variant="ghost" loading={busy} onClick={generate}>
            <RefreshCw className="size-3" /> Regenerate
          </Button>
        )}
      </div>
      <p className="text-sm leading-6">{brief.summary}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {list("Recently", brief.recent)}
        {list("Next", brief.next)}
      </div>
      {brief.risks.length > 0 && <div className="mt-4">{list("Watch", brief.risks)}</div>}
      <p className="mt-4 border-t border-border pt-3 text-2xs text-faint">
        Generated <RelativeTime iso={brief.generatedAt} />
        {brief.generatedBy && <> for {brief.generatedBy.displayName}</>} from this project&apos;s data. Summaries can be wrong; the linked tasks are the
        source of truth.
      </p>
    </Panel>
  );
}
