import type { SignalItem } from "@bldt/contracts";
import { CircleAlert, CircleDot, GitPullRequest, Layers, Milestone, Rocket, Timer, Unlink } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, shortDate } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "task.stalled": Timer,
  "task.overdue": CircleAlert,
  "review.waiting": GitPullRequest,
  "milestone.at_risk": Milestone,
  "wip.overload": Layers,
  "deploy.failing": Rocket,
  "pr.unlinked": Unlink,
};

export const SIGNAL_LABELS: Record<string, { name: string; hint: string }> = {
  "task.stalled": { name: "Stalled work", hint: "In progress or in review with no edits, comments or pull request updates." },
  "task.overdue": { name: "Overdue tasks", hint: "Open tasks past their due date. Critical after a week." },
  "review.waiting": { name: "Waiting for review", hint: "Ready pull requests with no review yet." },
  "milestone.at_risk": { name: "Milestones at risk", hint: "The forecast puts on-time delivery below your threshold." },
  "wip.overload": { name: "Too much in progress", hint: "One person holding more tasks in progress than the limit." },
  "deploy.failing": { name: "Failing deployments", hint: "The latest deployment to an environment failed. Critical for production." },
  "pr.unlinked": { name: "Unlinked pull requests", hint: "Three or more merged pull requests in two weeks with no task." },
};

export const severityTone = {
  CRITICAL: "text-danger",
  WARNING: "text-warning",
  INFO: "text-faint",
} as const;

export function SignalIcon({ signal, className }: { signal: Pick<SignalItem, "type" | "severity">; className?: string }) {
  const Icon = ICONS[signal.type] ?? CircleDot;
  return <Icon className={cn("size-3.5 shrink-0", severityTone[signal.severity], className)} aria-label={signal.severity.toLowerCase()} />;
}

/** Where a signal points: inside bld.t when possible, otherwise the GitHub URL. */
export function signalHref(s: Pick<SignalItem, "type" | "data" | "project">): { href: string; external: boolean } {
  const base = `/${s.project.ownerUsername}/${s.project.slug}`;
  const d = s.data;
  if ((s.type === "task.stalled" || s.type === "task.overdue") && typeof d.number === "number") return { href: `${base}/tasks?task=${d.number}`, external: false };
  if ((s.type === "review.waiting" || s.type === "deploy.failing") && typeof d.url === "string" && /^https:\/\//.test(d.url)) return { href: d.url, external: true };
  if (s.type === "milestone.at_risk") return { href: `${base}/milestones`, external: false };
  if (s.type === "pr.unlinked") return { href: `${base}/insights`, external: false };
  return { href: `${base}/tasks`, external: false };
}

/** One line of supporting evidence, so the alert explains itself. */
export function signalDetail(s: Pick<SignalItem, "type" | "data">): string | null {
  const d = s.data as Record<string, unknown>;
  switch (s.type) {
    case "task.stalled":
    case "task.overdue":
      return [d.taskTitle, d.assignee && d.assignee !== "Unassigned" ? `Assigned to ${d.assignee}` : "Unassigned"].filter(Boolean).join(" · ");
    case "review.waiting":
      return [d.prTitle, d.author ? `by ${d.author}` : null].filter(Boolean).join(" · ");
    case "milestone.at_risk":
      return d.p85 && d.dueOn ? `85% likely by ${shortDate(String(d.p85))}, due ${shortDate(String(d.dueOn))} · ${d.remaining} left` : d.dueOn ? `Due ${shortDate(String(d.dueOn))}` : null;
    case "wip.overload":
      return `Limit is ${d.limit}. Finishing one before starting another shortens every cycle.`;
    case "deploy.failing":
      return d.sha ? `Commit ${d.sha}` : null;
    case "pr.unlinked": {
      const ex = Array.isArray(d.examples) ? (d.examples as { number: number }[]).slice(0, 3).map((e) => `#${e.number}`) : [];
      return ex.length ? `Including ${ex.join(", ")}` : null;
    }
    default:
      return null;
  }
}
