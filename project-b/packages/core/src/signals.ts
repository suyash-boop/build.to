import type { Db, Prisma, SignalSeverity } from "@bldt/db";
import { notify } from "./notify.ts";

/**
 * Signals: problems worth a human's attention, found automatically.
 *
 *   gather snapshot  ->  detectSignals (pure)  ->  reconcileSignals (db)
 *
 * Detection is pure and deterministic over a snapshot, so every rule is unit-testable.
 * Reconciliation owns the lifecycle: open, update, escalate, auto-resolve, reopen, snooze.
 */

export const SIGNAL_TYPES = [
  "task.stalled",
  "task.overdue",
  "review.waiting",
  "milestone.at_risk",
  "wip.overload",
  "deploy.failing",
  "pr.unlinked",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export interface SignalSettings {
  /** Days without any movement before in-progress work counts as stalled. */
  stalledDays: number;
  /** Hours a ready PR may wait for its first review. */
  reviewHours: number;
  /** In-progress tasks one person can hold before it is flagged. */
  wipLimit: number;
  /** Below this on-time probability a milestone is at risk; below half of it, critical. */
  atRiskBelow: number;
  disabled: SignalType[];
}

export const DEFAULT_SIGNAL_SETTINGS: SignalSettings = {
  stalledDays: 5,
  reviewHours: 24,
  wipLimit: 3,
  atRiskBelow: 0.7,
  disabled: [],
};

export function resolveSettings(raw: unknown): SignalSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SignalSettings>;
  const num = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
  return {
    stalledDays: num(r.stalledDays, DEFAULT_SIGNAL_SETTINGS.stalledDays, 1, 60),
    reviewHours: num(r.reviewHours, DEFAULT_SIGNAL_SETTINGS.reviewHours, 1, 24 * 14),
    wipLimit: num(r.wipLimit, DEFAULT_SIGNAL_SETTINGS.wipLimit, 1, 20),
    atRiskBelow: num(r.atRiskBelow, DEFAULT_SIGNAL_SETTINGS.atRiskBelow, 0.1, 0.99),
    disabled: Array.isArray(r.disabled) ? r.disabled.filter((t): t is SignalType => (SIGNAL_TYPES as readonly string[]).includes(t as string)) : [],
  };
}

// ── Snapshot (what detectors look at) ────────────────────────

export interface SignalSnapshot {
  now: Date;
  project: { id: string; key: string; managerIds: string[] };
  inProgress: { id: string; number: number; title: string; assigneeId: string | null; lastMovedAt: Date }[];
  overdue: { id: string; number: number; title: string; assigneeId: string | null; dueOn: Date }[];
  waitingPrs: { id: string; number: number; title: string; url: string; repo: string; author: string; readySince: Date; linkedAssigneeIds: string[] }[];
  milestones: { id: string; title: string; dueOn: Date | null; remaining: number; onTimeProbability: number | null; p85: string | null }[];
  failingDeploys: { environment: string; sha: string; url: string | null; since: Date }[];
  unlinkedMergedPrs: { number: number; title: string; url: string }[];
  members: { id: string; name: string }[];
}

export interface SignalCandidate {
  type: SignalType;
  dedupeKey: string;
  severity: SignalSeverity;
  title: string;
  data: Record<string, unknown>;
  /** Users to notify when this opens or escalates. */
  recipients: string[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function detectSignals(s: SignalSnapshot, settings: SignalSettings): SignalCandidate[] {
  const out: SignalCandidate[] = [];
  const on = (t: SignalType) => !settings.disabled.includes(t);
  const id = (n: number) => `${s.project.key}-${n}`;
  const managers = s.project.managerIds;
  const name = (uid: string | null) => s.members.find((m) => m.id === uid)?.name ?? "Unassigned";

  if (on("task.stalled")) {
    for (const t of s.inProgress) {
      const idleDays = Math.floor((s.now.getTime() - t.lastMovedAt.getTime()) / DAY);
      if (idleDays < settings.stalledDays) continue;
      out.push({
        type: "task.stalled",
        dedupeKey: `task.stalled:${t.id}`,
        severity: idleDays >= settings.stalledDays * 2 ? "CRITICAL" : "WARNING",
        title: `${id(t.number)} has not moved in ${plural(idleDays, "day")}`,
        data: { taskId: t.id, number: t.number, identifier: id(t.number), taskTitle: t.title, idleDays, assignee: name(t.assigneeId) },
        recipients: t.assigneeId ? [t.assigneeId] : managers,
      });
    }
  }

  if (on("task.overdue")) {
    for (const t of s.overdue) {
      const lateDays = Math.max(1, Math.floor((s.now.getTime() - t.dueOn.getTime()) / DAY));
      out.push({
        type: "task.overdue",
        dedupeKey: `task.overdue:${t.id}`,
        severity: lateDays >= 7 ? "CRITICAL" : "WARNING",
        title: `${id(t.number)} is ${plural(lateDays, "day")} overdue`,
        data: { taskId: t.id, number: t.number, identifier: id(t.number), taskTitle: t.title, lateDays, assignee: name(t.assigneeId) },
        recipients: t.assigneeId ? [t.assigneeId] : managers,
      });
    }
  }

  if (on("review.waiting")) {
    for (const pr of s.waitingPrs) {
      const hours = Math.floor((s.now.getTime() - pr.readySince.getTime()) / HOUR);
      if (hours < settings.reviewHours) continue;
      out.push({
        type: "review.waiting",
        dedupeKey: `review.waiting:${pr.id}`,
        severity: hours >= settings.reviewHours * 3 ? "CRITICAL" : "WARNING",
        title: `#${pr.number} has waited ${hours >= 48 ? plural(Math.floor(hours / 24), "day") : plural(hours, "hour")} for a review`,
        data: { prNumber: pr.number, prTitle: pr.title, url: pr.url, repo: pr.repo, author: pr.author, waitingHours: hours },
        // Reviewers are whoever can review: the maintainers, not the author.
        recipients: managers.filter((m) => !pr.linkedAssigneeIds.includes(m) || managers.length === 1),
      });
    }
  }

  if (on("milestone.at_risk")) {
    for (const m of s.milestones) {
      if (m.remaining === 0 || !m.dueOn) continue;
      const overdue = m.dueOn.getTime() + DAY <= s.now.getTime();
      const p = m.onTimeProbability;
      if (!overdue && (p == null || p >= settings.atRiskBelow)) continue;
      out.push({
        type: "milestone.at_risk",
        dedupeKey: `milestone.at_risk:${m.id}`,
        severity: overdue || (p != null && p < settings.atRiskBelow / 2) ? "CRITICAL" : "WARNING",
        title: overdue
          ? `${m.title} is past its due date with ${plural(m.remaining, "task")} left`
          : `${m.title} has a ${Math.round((p ?? 0) * 100)}% chance of landing on time`,
        data: { milestoneId: m.id, milestoneTitle: m.title, remaining: m.remaining, onTimeProbability: p, p85: m.p85, dueOn: m.dueOn.toISOString().slice(0, 10), overdue },
        recipients: managers,
      });
    }
  }

  if (on("wip.overload")) {
    const byPerson = new Map<string, number>();
    for (const t of s.inProgress) if (t.assigneeId) byPerson.set(t.assigneeId, (byPerson.get(t.assigneeId) ?? 0) + 1);
    for (const [uid, count] of byPerson) {
      if (count <= settings.wipLimit) continue;
      out.push({
        type: "wip.overload",
        dedupeKey: `wip.overload:${uid}`,
        severity: "INFO",
        title: `${name(uid)} has ${count} tasks in progress at once`,
        data: { userId: uid, name: name(uid), count, limit: settings.wipLimit },
        recipients: [uid],
      });
    }
  }

  if (on("deploy.failing")) {
    for (const d of s.failingDeploys) {
      out.push({
        type: "deploy.failing",
        dedupeKey: `deploy.failing:${d.environment}`,
        severity: /prod/i.test(d.environment) ? "CRITICAL" : "WARNING",
        title: `The latest ${d.environment} deployment failed`,
        data: { environment: d.environment, sha: d.sha.slice(0, 7), url: d.url },
        recipients: managers,
      });
    }
  }

  if (on("pr.unlinked") && s.unlinkedMergedPrs.length >= 3) {
    out.push({
      type: "pr.unlinked",
      dedupeKey: "pr.unlinked",
      severity: "INFO",
      title: `${plural(s.unlinkedMergedPrs.length, "merged pull request")} in the last two weeks are not linked to any task`,
      data: { count: s.unlinkedMergedPrs.length, examples: s.unlinkedMergedPrs.slice(0, 5) },
      recipients: [],
    });
  }

  return out;
}

// ── Reconciliation (lifecycle) ───────────────────────────────

const RANK: Record<SignalSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

export interface ReconcileResult {
  opened: number;
  updated: number;
  resolved: number;
  notified: number;
}

/**
 * Bring stored signals in line with what detection found now. INFO signals never notify;
 * snoozed signals keep updating silently; an escalation in severity notifies again.
 */
export async function reconcileSignals(
  db: Db,
  projectId: string,
  project: { name: string; slug: string; ownerUsername: string },
  candidates: SignalCandidate[],
  now = new Date(),
  opts: { keepUnseen?: readonly SignalType[] } = {},
): Promise<ReconcileResult> {
  const result: ReconcileResult = { opened: 0, updated: 0, resolved: 0, notified: 0 };
  const existing = await db.signal.findMany({ where: { projectId } });
  const byKey = new Map(existing.map((s) => [s.dedupeKey, s]));
  const seen = new Set<string>();

  for (const c of candidates) {
    seen.add(c.dedupeKey);
    const prev = byKey.get(c.dedupeKey);
    const wasOpen = prev != null && prev.resolvedAt == null;
    // A snooze belongs to one occurrence; a reopened signal starts unsnoozed.
    const snoozed = wasOpen && prev.snoozedUntil != null && prev.snoozedUntil > now;
    const escalated = wasOpen && prev.notifiedSeverity != null && RANK[c.severity] > RANK[prev.notifiedSeverity];
    const shouldNotify = c.severity !== "INFO" && c.recipients.length > 0 && !snoozed && (!wasOpen || escalated || prev.notifiedAt == null);

    const base = { type: c.type, severity: c.severity, title: c.title, data: c.data as Prisma.InputJsonValue, lastSeenAt: now };
    if (!prev) {
      await db.signal.create({
        data: { projectId, dedupeKey: c.dedupeKey, ...base, firstSeenAt: now, ...(shouldNotify ? { notifiedAt: now, notifiedSeverity: c.severity } : {}) },
      });
      result.opened++;
    } else {
      await db.signal.update({
        where: { id: prev.id },
        data: {
          ...base,
          // A problem that comes back is a new occurrence.
          ...(wasOpen ? {} : { resolvedAt: null, firstSeenAt: now, snoozedUntil: null, notifiedAt: null, notifiedSeverity: null }),
          ...(shouldNotify ? { notifiedAt: now, notifiedSeverity: c.severity } : {}),
        },
      });
      if (wasOpen) result.updated++;
      else result.opened++;
    }

    if (shouldNotify) {
      await notify(db, c.recipients, "signal.raised", {
        projectName: project.name,
        projectSlug: project.slug,
        ownerUsername: project.ownerUsername,
        signalType: c.type,
        severity: c.severity,
        title: c.title,
        ...pickLinkData(c.data),
      }, { projectId });
      result.notified += c.recipients.length;
    }
  }

  // Types whose inputs were truncated this run stay open until a complete scan says otherwise.
  const keep = new Set<string>(opts.keepUnseen ?? []);
  const stale = existing.filter((s) => s.resolvedAt == null && !seen.has(s.dedupeKey) && !keep.has(s.type));
  if (stale.length) {
    await db.signal.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { resolvedAt: now } });
    result.resolved = stale.length;
  }
  return result;
}

function pickLinkData(d: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ["number", "identifier", "prNumber", "url", "milestoneId"]) if (d[k] != null) out[k] = d[k];
  return out;
}
