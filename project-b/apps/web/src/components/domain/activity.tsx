"use client";

import type { ActivityItem } from "@bldt/contracts";
import { STAGE_LABEL, STATUS_LABEL, type ProjectStage, type TaskStatus } from "@bldt/contracts";
import { GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, MessageSquareCheck, Rocket, Tag, UserMinus, UserPlus, Flag, CircleDot, Server, Sparkle, MessagesSquare, CircleCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/misc";
import { useNow } from "@/lib/use-now";
import { cn, isHttpUrl } from "@/lib/utils";
import { StatusIcon, TrustMark } from "./status";
import { RelativeTime } from "./time";

type P = Record<string, any>;

/** Payload URLs come from GitHub and workers: only http(s) becomes a link. */
function Ext({ href, children }: { href?: string; children: ReactNode }) {
  if (!isHttpUrl(href)) return <span className="font-medium text-fg">{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-fg hover:underline">
      {children}
    </a>
  );
}

/** One sentence per event. Returns icon + body; unknown types fall back to a neutral line. */
/** `proj` is the linked project name when the feed spans projects; events about the project itself name it inline. */
function describe(e: ActivityItem, taskHref: (n: string) => string | null, proj: ReactNode | null = null): { icon: ReactNode; body: ReactNode; detail?: ReactNode; inlinesProject?: boolean } {
  const p = e.payload as P;
  const iconCls = "size-3.5";
  const task = (id: string, title: string) => {
    const href = taskHref(id);
    const label = (
      <>
        <span className="font-mono text-xs text-faint">{id}</span> <span className="font-medium text-fg">{title}</span>
      </>
    );
    return href ? <Link href={href} className="hover:underline">{label}</Link> : label;
  };

  switch (e.type) {
    case "project.created":
      return { icon: <Sparkle className={iconCls} />, body: proj ? <>started {proj}</> : <>started the project</>, inlinesProject: true };
    case "project.stage_changed":
      return {
        icon: <Flag className={iconCls} />,
        body: <>moved {proj ?? "the project"} to <span className="font-medium text-fg">{STAGE_LABEL[p.to as ProjectStage] ?? p.to}</span></>,
        inlinesProject: true,
      };
    case "project.shipped":
      return {
        icon: <Rocket className={cn(iconCls, "text-st-shipped")} />,
        body: <>shipped <Ext href={p.url}>{p.title}</Ext>{p.version ? <span className="ml-1 font-mono text-xs text-faint">{p.version}</span> : null}</>,
      };
    case "release.published":
      return {
        icon: <Tag className={iconCls} />,
        body: <>published <Ext href={p.url}>{p.title}</Ext>{p.version ? <span className="ml-1 font-mono text-xs text-faint">{p.version}</span> : null}</>,
      };
    case "member.joined":
      return { icon: <UserPlus className={iconCls} />, body: proj ? <>joined {proj} as {String(p.role ?? "member").toLowerCase()}</> : <>joined as {String(p.role ?? "member").toLowerCase()}</>, inlinesProject: true };
    case "member.left":
      return { icon: <UserMinus className={iconCls} />, body: <>{p.removedBy ? "was removed from " : "left "}{proj ?? "the project"}</>, inlinesProject: true };
    case "task.created":
      return { icon: <CircleDot className={iconCls} />, body: <>created {task(p.identifier, p.title)}</> };
    case "task.completed":
      return {
        icon: <StatusIcon status="DONE" />,
        body: (
          <>
            completed {task(p.identifier, p.title)}
            {p.via?.kind === "pull_request" && <span className="text-faint"> via <Ext href={p.via.url}>#{p.via.number}</Ext></span>}
          </>
        ),
      };
    case "task.status_changed":
      return {
        icon: <StatusIcon status={p.to as TaskStatus} />,
        body: (
          <>
            moved {task(p.identifier, p.title)} to {STATUS_LABEL[p.to as TaskStatus]?.toLowerCase()}
            {p.via?.kind === "pull_request" && <span className="text-faint"> via <Ext href={p.via.url}>#{p.via.number}</Ext></span>}
          </>
        ),
      };
    case "task.due_changed":
      return { icon: <CircleDot className={iconCls} />, body: <>{p.dueOn ? "set a due date on" : "cleared the due date on"} {task(p.identifier, p.title)}</> };
    case "milestone.completed":
      return { icon: <Flag className={cn(iconCls, "text-st-shipped")} />, body: <>completed milestone <span className="font-medium text-fg">{p.title}</span></> };
    case "discussion.created":
    case "discussion.solved": {
      const href = e.project ? `/${e.project.ownerUsername}/${e.project.slug}/discussions/${p.number}` : null;
      const label = <span className="font-medium text-fg">{p.title}</span>;
      const link = href ? <Link href={href} className="hover:underline">{label}</Link> : label;
      return e.type === "discussion.solved"
        ? { icon: <CircleCheck className={cn(iconCls, "text-success")} />, body: <>marked {link} as solved</> }
        : { icon: <MessagesSquare className={iconCls} />, body: <>{p.category === "HELP" ? "asked for help:" : p.category === "ANNOUNCEMENTS" ? "announced" : "started a discussion:"} {link}</> };
    }
    case "github.push":
      return {
        icon: <GitCommitHorizontal className={iconCls} />,
        body: (
          <>
            pushed <Ext href={p.compareUrl}>{p.count === 1 ? "1 commit" : `${p.count} commits`}</Ext> to <span className="font-mono text-xs">{p.branch}</span>
          </>
        ),
        detail: Array.isArray(p.messages) && p.messages.length > 0 ? p.messages.at(-1) : undefined,
      };
    case "github.pr_opened":
      return { icon: <GitPullRequest className={iconCls} />, body: <>opened <Ext href={p.url}>#{p.number} {p.title}</Ext></> };
    case "github.pr_merged":
      return {
        icon: <GitMerge className={cn(iconCls, "text-st-shipped")} />,
        body: (
          <>
            merged <Ext href={p.url}>#{p.number} {p.title}</Ext>
            {p.additions ? <span className="ml-1.5 font-mono text-2xs"><span className="text-success">+{p.additions}</span> <span className="text-danger">−{p.deletions}</span></span> : null}
          </>
        ),
      };
    case "github.pr_closed":
      return { icon: <GitPullRequestClosed className={iconCls} />, body: <>closed <Ext href={p.url}>#{p.number} {p.title}</Ext></> };
    case "github.review":
      return {
        icon: <MessageSquareCheck className={iconCls} />,
        body: <>{p.state === "approved" ? "approved" : p.state === "changes_requested" ? "requested changes on" : "reviewed"} <Ext href={p.url}>#{p.number} {p.title}</Ext></>,
      };
    case "github.deployment":
      return {
        icon: <Server className={cn(iconCls, "text-st-shipped")} />,
        body: <>deployed <span className="font-mono text-xs">{p.sha}</span> to <Ext href={p.url ?? undefined}>{p.environment}</Ext></>,
      };
    default:
      return { icon: <CircleDot className={iconCls} />, body: <>{e.type.replace(/[._]/g, " ")}</> };
  }
}

/** Event types that collapse when one person does several in a row. */
const GROUPABLE = new Set(["task.created", "task.completed", "github.push"]);
const GROUP_WINDOW_MS = 30 * 60 * 1000;

interface FeedEntry {
  head: ActivityItem;
  rest: ActivityItem[];
}

/** Collapse bursts (eight tasks created in a minute) into one line so the feed stays readable. */
function groupFeed(items: ActivityItem[]): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const e of items) {
    const last = out[out.length - 1];
    const sameActor = last && (last.head.actor?.id ?? last.head.actorLogin) === (e.actor?.id ?? e.actorLogin);
    if (
      last &&
      GROUPABLE.has(e.type) &&
      last.head.type === e.type &&
      sameActor &&
      last.head.project?.id === e.project?.id &&
      Math.abs(new Date(last.head.occurredAt).getTime() - new Date(e.occurredAt).getTime()) < GROUP_WINDOW_MS
    ) {
      last.rest.push(e);
    } else {
      out.push({ head: e, rest: [] });
    }
  }
  return out;
}

function groupedBody(entry: FeedEntry, taskHref: (id: string) => string | null): ReactNode {
  const all = [entry.head, ...entry.rest];
  const n = all.length;
  if (entry.head.type === "github.push") {
    const commits = all.reduce((a, e) => a + Number((e.payload as P).count ?? 0), 0);
    return <>pushed {commits} commits in {n} pushes to <span className="font-mono text-xs">{(entry.head.payload as P).branch}</span></>;
  }
  const verb = entry.head.type === "task.created" ? "created" : "completed";
  const ids = all.map((e) => (e.payload as P).identifier as string).filter(Boolean);
  const shown = ids.slice(0, 3);
  return (
    <>
      {verb} {n} tasks{" "}
      <span className="text-faint">
        {shown.map((id, i) => {
          const href = taskHref(id);
          return (
            <span key={id}>
              {i > 0 && ", "}
              {href ? <Link href={href} className="font-mono text-xs hover:underline">{id}</Link> : <span className="font-mono text-xs">{id}</span>}
            </span>
          );
        })}
        {ids.length > shown.length && <> and {ids.length - shown.length} more</>}
      </span>
    </>
  );
}

/** "Today", "Yesterday", or a date, for grouping long feeds by day, in the viewer's timezone. */
function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function ActivityFeed({
  items,
  showProject = false,
  compact = false,
  byDay = false,
  limit,
  emptyText = "No activity yet.",
}: {
  items: ActivityItem[];
  showProject?: boolean;
  compact?: boolean;
  /** Insert day headings; for wide, long feeds. */
  byDay?: boolean;
  /** Show at most this many rows after grouping. */
  limit?: number;
  emptyText?: string;
}) {
  // Day headings depend on the viewer's clock and timezone, so they appear after mount.
  const now = useNow();
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  const all = groupFeed(items);
  const entries = limit ? all.slice(0, limit) : all;
  let lastDay = "";

  return (
    <ol className="relative">
      {entries.map((entry, i) => {
        const e = entry.head;
        const base = e.project ? `/${e.project.ownerUsername}/${e.project.slug}` : null;
        const taskHref = (id: string) => {
          const n = id?.split("-").pop();
          return base && n ? `${base}/tasks?task=${n}` : null;
        };
        const projLink = showProject && e.project ? <Link href={base!} className="font-medium text-fg hover:underline">{e.project.name}</Link> : null;
        const described = describe(e, taskHref, projLink);
        const body = entry.rest.length ? groupedBody(entry, taskHref) : described.body;
        const detail = entry.rest.length ? undefined : described.detail;
        const actorName = e.actor?.displayName ?? e.actorLogin ?? "Someone";
        const day = byDay && now ? dayLabel(e.occurredAt, now) : "";
        const heading = day && day !== lastDay ? day : null;
        lastDay = day;
        const last = i === entries.length - 1;

        return (
          <li key={e.id}>
            {heading && (
              <p className={cn("pb-1 text-2xs font-medium uppercase tracking-wide text-faint", i === 0 ? "pt-1" : "pt-4")}>{heading}</p>
            )}
            <div className={cn("relative flex gap-3", compact ? "py-1.5" : "py-2")}>
              {!last && <span className="absolute left-[9px] top-7 bottom-[-6px] w-px bg-border" aria-hidden />}
              <span className="relative z-10 mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted">
                {described.icon}
              </span>
              <div className="min-w-0 flex-1 text-sm leading-5 text-muted">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1">
                    {e.actor ? (
                      <Link href={`/${e.actor.username}`} className="inline-flex items-center gap-1.5 align-top font-medium text-fg hover:underline">
                        <Avatar user={e.actor} size={16} />
                        {actorName}
                      </Link>
                    ) : (
                      <span className="font-medium text-fg">{actorName}</span>
                    )}{" "}
                    {body}
                    {showProject && e.project && !described.inlinesProject && (
                      <>
                        {" "}
                        <span className="text-faint">in</span>{" "}
                        <Link href={base!} className="text-fg hover:underline">
                          {e.project.name}
                        </Link>
                      </>
                    )}
                  </p>
                  <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-xs text-faint">
                    {/* Platform-recorded is the default; only verified-from-GitHub earns a mark. */}
                    {e.trust === "CONNECTED" && <TrustMark trust="CONNECTED" />}
                    <RelativeTime iso={e.occurredAt} className="tnum" />
                  </span>
                </div>
                {detail && <p className="mt-0.5 truncate text-xs text-faint">{detail}</p>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
