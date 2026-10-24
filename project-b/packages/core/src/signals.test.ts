import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_SETTINGS, detectSignals, resolveSettings, type SignalSnapshot } from "./signals.ts";

const now = new Date("2026-10-03T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

function snap(over: Partial<SignalSnapshot> = {}): SignalSnapshot {
  return {
    now,
    project: { id: "p", key: "RELAY", managerIds: ["owner"] },
    inProgress: [],
    overdue: [],
    waitingPrs: [],
    milestones: [],
    failingDeploys: [],
    unlinkedMergedPrs: [],
    members: [{ id: "owner", name: "Maya" }, { id: "ari", name: "Ari" }],
    ...over,
  };
}
const types = (s: SignalSnapshot, settings = DEFAULT_SIGNAL_SETTINGS) => detectSignals(s, settings).map((c) => `${c.type}:${c.severity}`);

describe("detectSignals", () => {
  it("flags stalled work by idle time, escalating at twice the threshold", () => {
    const s = snap({
      inProgress: [
        { id: "a", number: 1, title: "fresh", assigneeId: "ari", lastMovedAt: ago(2) },
        { id: "b", number: 2, title: "stalled", assigneeId: "ari", lastMovedAt: ago(6) },
        { id: "c", number: 3, title: "abandoned", assigneeId: null, lastMovedAt: ago(12) },
      ],
    });
    const out = detectSignals(s, DEFAULT_SIGNAL_SETTINGS);
    expect(out.map((c) => [c.dedupeKey, c.severity])).toEqual([
      ["task.stalled:b", "WARNING"],
      ["task.stalled:c", "CRITICAL"],
    ]);
    // Assigned work notifies the assignee; unassigned work notifies managers.
    expect(out[0]!.recipients).toEqual(["ari"]);
    expect(out[1]!.recipients).toEqual(["owner"]);
    expect(out[0]!.title).toBe("RELAY-2 has not moved in 6 days");
  });

  it("respects per-project thresholds and disabled types", () => {
    const s = snap({ inProgress: [{ id: "b", number: 2, title: "x", assigneeId: "ari", lastMovedAt: ago(6) }] });
    expect(types(s, resolveSettings({ stalledDays: 10 }))).toEqual([]);
    expect(types(s, resolveSettings({ disabled: ["task.stalled"] }))).toEqual([]);
  });

  it("flags PRs waiting on review past the threshold", () => {
    const s = snap({
      waitingPrs: [
        { id: "p1", number: 10, title: "quick", url: "u", repo: "r", author: "a", readySince: hoursAgo(5), linkedAssigneeIds: [] },
        { id: "p2", number: 11, title: "slow", url: "u", repo: "r", author: "a", readySince: hoursAgo(30), linkedAssigneeIds: [] },
        { id: "p3", number: 12, title: "stuck", url: "u", repo: "r", author: "a", readySince: hoursAgo(80), linkedAssigneeIds: [] },
      ],
    });
    expect(types(s)).toEqual(["review.waiting:WARNING", "review.waiting:CRITICAL"]);
    expect(detectSignals(s, DEFAULT_SIGNAL_SETTINGS)[1]!.title).toBe("#12 has waited 3 days for a review");
  });

  it("uses the forecast for milestone risk and treats a passed due date as critical", () => {
    const s = snap({
      milestones: [
        { id: "safe", title: "Beta", dueOn: ago(-30), remaining: 4, onTimeProbability: 0.92, p85: "2026-10-20" },
        { id: "risky", title: "GA", dueOn: ago(-14), remaining: 10, onTimeProbability: 0.55, p85: "2026-11-02" },
        { id: "doomed", title: "v2", dueOn: ago(-7), remaining: 30, onTimeProbability: 0.1, p85: null },
        { id: "late", title: "v0", dueOn: ago(3), remaining: 2, onTimeProbability: 0, p85: null },
        { id: "finished", title: "Done", dueOn: ago(3), remaining: 0, onTimeProbability: null, p85: null },
      ],
    });
    expect(detectSignals(s, DEFAULT_SIGNAL_SETTINGS).map((c) => [c.dedupeKey, c.severity])).toEqual([
      ["milestone.at_risk:risky", "WARNING"],
      ["milestone.at_risk:doomed", "CRITICAL"],
      ["milestone.at_risk:late", "CRITICAL"],
    ]);
  });

  it("flags work-in-progress overload per person as information only", () => {
    const tasks = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, number: n, title: "x", assigneeId: "ari", lastMovedAt: ago(0) }));
    const out = detectSignals(snap({ inProgress: tasks }), DEFAULT_SIGNAL_SETTINGS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "wip.overload", severity: "INFO", title: "Ari has 4 tasks in progress at once" });
  });

  it("only reports unlinked merged PRs once there is a pattern", () => {
    const pr = (n: number) => ({ number: n, title: "x", url: "u" });
    expect(types(snap({ unlinkedMergedPrs: [pr(1), pr(2)] }))).toEqual([]);
    expect(types(snap({ unlinkedMergedPrs: [pr(1), pr(2), pr(3)] }))).toEqual(["pr.unlinked:INFO"]);
  });

  it("treats production deploy failures as critical", () => {
    const s = snap({
      failingDeploys: [
        { environment: "production", sha: "abcdef123", url: null, since: ago(0) },
        { environment: "preview", sha: "abcdef123", url: null, since: ago(0) },
      ],
    });
    expect(types(s)).toEqual(["deploy.failing:CRITICAL", "deploy.failing:WARNING"]);
  });
});

describe("resolveSettings", () => {
  it("clamps out-of-range and ignores junk", () => {
    expect(resolveSettings({ stalledDays: 0, reviewHours: 99999, wipLimit: "x", disabled: ["task.stalled", "nope"] })).toEqual({
      ...DEFAULT_SIGNAL_SETTINGS,
      stalledDays: 1,
      reviewHours: 336,
      disabled: ["task.stalled"],
    });
  });
});
