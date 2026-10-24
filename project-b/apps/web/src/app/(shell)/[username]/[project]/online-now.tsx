"use client";

import type { PresenceEntry } from "@bldt/contracts";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, GitBranch, Video } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { Avatar, SectionHeader } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/overlay";
import { errorMessage, http } from "@/lib/api.client";
import { cn, isHttpUrl } from "@/lib/utils";

/** Teammates working on this project right now, from their editors. Members only. */
export function OnlineNow({ owner, slug, viewerId }: { owner: string; slug: string; viewerId: string }) {
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["presence", owner, slug],
    queryFn: () => http.get<{ items: PresenceEntry[] }>(`/projects/${owner}/${slug}/presence`).then((r) => r.items),
    // Live events cover changes; the interval catches people going quiet (no event when a laptop sleeps).
    refetchInterval: 30_000,
  });
  const [busy, setBusy] = useState(false);
  const people = data ?? [];
  const others = people.filter((p) => p.user.id !== viewerId);

  const huddle = async () => {
    // Open the window inside the click: after the await, popup blockers no longer see a
    // user gesture. Point it at the huddle once the API answers.
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    setBusy(true);
    try {
      const res = await http.post<{ huddle: { url: string }; invited: number }>(`/projects/${owner}/${slug}/huddles`, {});
      const url = res.huddle.url;
      const invited = `Huddle started. ${res.invited === 1 ? "1 teammate was" : `${res.invited} teammates were`} invited.`;
      if (win && !win.closed && isHttpUrl(url)) {
        win.location.href = url;
        toast.success(invited);
      } else {
        win?.close();
        toast.success(invited, {
          description: isHttpUrl(url) ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              Open the huddle
            </a>
          ) : undefined,
          duration: 15_000,
        });
      }
    } catch (err) {
      win?.close();
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionHeader
        title="Online now"
        count={people.length || undefined}
        action={
          others.length > 0 ? (
            <Button size="xs" variant="ghost" onClick={huddle} loading={busy}>
              <Video className="size-3" /> Huddle
            </Button>
          ) : undefined
        }
      />
      {isPending ? (
        <p className="text-sm text-faint">Loading</p>
      ) : isError && people.length === 0 ? (
        <LoadError title="Could not load who is online" error={error} onRetry={() => refetch()} retrying={isRefetching} className="items-start text-left" />
      ) : people.length === 0 ? (
        <p className="text-sm text-muted">Nobody is working in an editor right now. Install the VS Code extension to show up here.</p>
      ) : (
        <ul className="space-y-2.5">
          {people.map((p) => (
            <li key={p.user.id} className="flex items-start gap-2">
              <span className="relative mt-0.5 shrink-0">
                <Avatar user={p.user} size={20} />
                <span className={cn("absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-bg", p.state === "active" ? "bg-success" : "bg-warning")} aria-label={p.state} />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate">
                  {p.user.displayName}
                  {p.user.id === viewerId && <span className="text-faint"> (you)</span>}
                </p>
                {p.task && (
                  <p className="truncate text-xs text-muted">
                    <span className="font-mono text-2xs text-faint">{p.task.identifier}</span> {p.task.title}
                  </p>
                )}
                <p className="flex min-w-0 items-center gap-2 text-2xs text-faint">
                  {p.filePath ? (
                    <Tooltip content={<span className="font-mono">{p.filePath}</span>}>
                      <span className="flex min-w-0 items-center gap-1 font-mono">
                        <FileCode2 className="size-3 shrink-0" />
                        <span className="truncate">{p.filePath.split("/").pop()}</span>
                      </span>
                    </Tooltip>
                  ) : p.branch ? (
                    <span className="flex min-w-0 items-center gap-1 font-mono">
                      <GitBranch className="size-3 shrink-0" />
                      <span className="truncate">{p.branch}</span>
                    </span>
                  ) : null}
                  <span className="shrink-0">
                    {p.state === "idle" ? "idle" : "active"} · <RelativeTime iso={p.since} />
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
