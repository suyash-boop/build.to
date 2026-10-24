import { describe, expect, it } from "vitest";
import { keepKnownRefs, knownRefs, type BriefInput } from "./index.ts";

const input: BriefInput = {
  project: { name: "Relay", key: "RELAY", tagline: null, stage: "BUILDING", createdAt: "2026-09-01", shippedAt: null },
  readme: null,
  milestones: [],
  openTasks: [{ id: "RELAY-2", title: "Sliding window", status: "TODO", priority: "HIGH", assignee: null, dueOn: null }],
  recentlyDone: [{ id: "RELAY-1", title: "Token bucket", completedAt: "2026-10-01" }],
  mergedPrs: [{ number: 48, title: "Bucket", author: "maya", mergedAt: "2026-10-01" }],
  openPrs: [],
  releases: [],
  today: "2026-10-03",
};

describe("keepKnownRefs", () => {
  it("keeps references that exist in the input and drops invented ones", () => {
    const out = keepKnownRefs(
      {
        summary: " Relay is building. ",
        recent: [{ text: "Bucket landed", refs: ["RELAY-1", "#48", "48", "RELAY-99", "#7"] }],
        next: [{ text: "Sliding window", refs: ["RELAY-2"] }],
        risks: [],
      },
      knownRefs(input),
    );
    expect(out.summary).toBe("Relay is building.");
    expect(out.recent[0]!.refs).toEqual(["RELAY-1", "#48"]);
    expect(out.next[0]!.refs).toEqual(["RELAY-2"]);
  });

  it("caps list lengths even if the model returns more", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ text: `x${i}`, refs: [] }));
    const out = keepKnownRefs({ summary: "s", recent: many, next: many, risks: many }, knownRefs(input));
    expect([out.recent.length, out.next.length, out.risks.length]).toEqual([5, 4, 3]);
  });
});
