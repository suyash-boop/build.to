"use client";

import type { NotificationItem, Paginated } from "@bldt/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, CheckCheck, CircleCheck, CircleX, Code2, FileWarning, Inbox, MessageSquare, Rocket, UserPlus, Users, Video, Webhook } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SignalIcon, signalHref } from "@/components/domain/signal";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/choice";
import { LoadError } from "@/components/ui/load-error";
import { EmptyState, Panel } from "@/components/ui/misc";
import { errorMessage, http } from "@/lib/api.client";
import { cn } from "@/lib/utils";

type D = Record<string, any>;

function render(n: NotificationItem): { icon: ReactNode; body: ReactNode; href: string | null } {
  const d = n.data as D;
  const project = d.ownerUsername && d.projectSlug ? `/${d.ownerUsername}/${d.projectSlug}` : null;
  const P = () => <span className="font-medium text-fg">{d.projectName}</span>;
  switch (n.type) {
    case "invitation.received":
      return { icon: <UserPlus className="size-4 text-accent" />, body: <><span className="font-medium text-fg">{d.inviter}</span> invited you to <P /> as {String(d.role).toLowerCase()}</>, href: project };
    case "request.received":
      return { icon: <Users className="size-4" />, body: <><span className="font-medium text-fg">{d.username}</span> asked to join <P />{d.roleWanted ? ` for ${d.roleWanted}` : ""}</>, href: project ? `${project}/people` : null };
    case "request.approved":
      return { icon: <CircleCheck className="size-4 text-success" />, body: <>Your request to join <P /> was approved</>, href: project };
    case "request.declined":
      return { icon: <CircleX className="size-4" />, body: <>Your request to join <P /> was declined</>, href: project };
    case "member.joined":
      return { icon: <UserPlus className="size-4" />, body: <><span className="font-medium text-fg">{d.username}</span> joined <P /></>, href: project ? `${project}/people` : null };
    case "task.assigned":
      return {
        icon: <AtSign className="size-4" />,
        body: <>You were assigned <span className="font-mono text-xs text-faint">{d.identifier}</span> <span className="font-medium text-fg">{d.title}</span> in <P /></>,
        href: project ? `${project}/tasks?task=${d.number}` : null,
      };
    case "task.commented":
      return {
        icon: <MessageSquare className="size-4" />,
        body: (
          <>
            <span className="font-medium text-fg">{d.author}</span> commented on <span className="font-mono text-xs text-faint">{d.identifier}</span>{" "}
            <span className="font-medium text-fg">{d.title}</span>
            {d.excerpt && <span className="mt-0.5 block truncate text-xs text-faint">{d.excerpt}</span>}
          </>
        ),
        href: project ? `${project}/tasks?task=${d.number}` : null,
      };
    case "project.shipped":
      return { icon: <Rocket className="size-4 text-st-shipped" />, body: <><P /> shipped: <span className="text-fg">{d.title}</span>{d.version ? <span className="ml-1 font-mono text-xs text-faint">{d.version}</span> : null}</>, href: project ? `${project}/releases` : null };
    case "discussion.help":
    case "discussion.announcement":
    case "discussion.mentioned":
    case "discussion.replied":
    case "discussion.answered": {
      const verb =
        n.type === "discussion.help" ? "needs help" : n.type === "discussion.announcement" ? "announced" : n.type === "discussion.mentioned" ? "mentioned you in" : n.type === "discussion.replied" ? "replied to" : "";
      return {
        icon: n.type === "discussion.answered" ? <CircleCheck className="size-4 text-success" /> : <MessageSquare className={cn("size-4", n.type === "discussion.help" && "text-warning")} />,
        body:
          n.type === "discussion.answered" ? (
            <>Your reply was marked as the solution to <span className="font-medium text-fg">{d.title}</span> in <P /></>
          ) : (
            <>
              <span className="font-medium text-fg">{d.author}</span> {verb} <span className="font-medium text-fg">{d.title}</span> in <P />
              {d.errorHeadline && <span className="mt-0.5 block truncate font-mono text-2xs text-faint">{d.errorHeadline}</span>}
              {d.excerpt && <span className="mt-0.5 block truncate text-xs text-faint">{d.excerpt}</span>}
            </>
          ),
        href: project ? `${project}/discussions/${d.number}` : null,
      };
    }
    case "presence.overlap":
      return {
        icon: <FileWarning className="size-4 text-warning" />,
        body: <><span className="font-medium text-fg">{d.who}</span> is editing <span className="font-mono text-xs">{d.filePath}</span> too{d.theirBranch ? <> on <span className="font-mono text-xs">{d.theirBranch}</span></> : null} in <P />. Coordinate before you both push.</>,
        href: project,
      };
    case "huddle.invite":
      return {
        icon: <Video className="size-4 text-accent" />,
        body: <><span className="font-medium text-fg">{d.host}</span> invited you to {d.kind === "PAIR" ? "pair in VS Code" : "a huddle"} in <P />{d.topic ? <>: {d.topic}</> : null}</>,
        href: typeof d.url === "string" && d.url.startsWith("https://") ? d.url : project,
      };
    case "security.device_signed_in":
      return {
        icon: <Code2 className="size-4" />,
        body: <><span className="font-medium text-fg">{d.clientName}</span> was connected to your account{d.ip ? <> from <span className="font-mono text-xs">{d.ip}</span></> : null}. Not you? Disconnect it in Settings.</>,
        href: "/settings",
      };
    case "webhook.disabled": {
      let host = "";
      try {
        host = new URL(String(d.url)).host;
      } catch {}
      return {
        icon: <Webhook className="size-4 text-warning" />,
        body: <>A webhook in <P /> was turned off{host ? <> (<span className="font-mono text-xs">{host}</span>)</> : null}: {d.reason}</>,
        href: project ? `${project}/settings#webhooks` : null,
      };
    }
    case "signal.raised": {
      const severity = d.severity === "CRITICAL" ? "CRITICAL" : "WARNING";
      const target = project ? signalHref({ type: d.signalType, data: d, project: { name: d.projectName, slug: d.projectSlug, ownerUsername: d.ownerUsername } }) : null;
      return {
        icon: <SignalIcon signal={{ type: d.signalType, severity }} className="size-4" />,
        body: <><P />: <span className="text-fg">{d.title}</span>{severity === "CRITICAL" && <span className="ml-1.5 text-xs text-danger">Critical</span>}</>,
        // Inbox rows stay inside bld.t; the overview card links out to GitHub.
        href: target && !target.external ? target.href : project,
      };
    }
    default:
      return { icon: <Inbox className="size-4" />, body: n.type, href: project };
  }
}

export function InboxList({ initial }: { initial: Paginated<NotificationItem> }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const q = useInfiniteQuery({
    queryKey: ["notifications", filter],
    queryFn: ({ pageParam }) => http.get<Paginated<NotificationItem>>(`/notifications?limit=50${filter === "unread" ? "&unread=true" : ""}${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
    initialData: filter === "all" ? { pages: [initial], pageParams: [null] } : undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  const markRead = async (body: { ids?: string[]; all?: boolean }) => {
    try {
      await http.post("/notifications/read", body);
      await qc.invalidateQueries({ queryKey: ["notifications"] });
      await qc.invalidateQueries({ queryKey: ["me", "unread"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} />
        <Button size="sm" variant="ghost" disabled={unread === 0} onClick={() => markRead({ all: true })}>
          <CheckCheck className="size-3.5" /> Mark all read
        </Button>
      </div>
      {q.isError && items.length === 0 ? (
        <LoadError title="Could not load your inbox" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} className="rounded-lg border border-border py-10" />
      ) : items.length === 0 && q.isPending ? (
        <p className="py-10 text-center text-sm text-faint">Loading</p>
      ) : items.length === 0 ? (
        <EmptyState icon={<Inbox className="size-5" />} title={filter === "unread" ? "All caught up" : "Nothing here yet"}>
          Invitations, assignments, comments that mention you, ships, and alerts about work that needs you arrive here.
        </EmptyState>
      ) : (
        <Panel className="divide-y divide-border overflow-hidden">
          {items.map((n) => {
            const { icon, body, href } = render(n);
            const content = (
              <>
                <span className="mt-0.5 flex w-4 shrink-0 justify-center text-muted">{icon}</span>
                <span className="min-w-0 flex-1 text-sm text-muted">{body}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <RelativeTime iso={n.createdAt} className="text-xs text-faint" />
                  <span className={cn("size-1.5 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-label={n.readAt ? undefined : "Unread"} />
                </span>
              </>
            );
            const cls = cn("flex items-start gap-3 px-4 py-3 hover:bg-surface-hover", !n.readAt && "bg-surface-hover/40");
            return href ? (
              <Link
                key={n.id}
                href={href}
                className={cls}
                onClick={() => {
                  // markRead invalidates the unread badge; no router.refresh() while navigating away.
                  if (!n.readAt) void markRead({ ids: [n.id] });
                }}
              >
                {content}
              </Link>
            ) : (
              <div key={n.id} className={cls}>{content}</div>
            );
          })}
        </Panel>
      )}
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load older</Button>
        </div>
      )}
    </div>
  );
}
