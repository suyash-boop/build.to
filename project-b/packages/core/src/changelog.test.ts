import { describe, expect, it } from "vitest";
import { buildChangelog, changelogMarkdown, classify, type ChangelogPr } from "./changelog.ts";

const pr = (number: number, title: string, over: Partial<ChangelogPr> = {}): ChangelogPr => ({
  number,
  title,
  url: `https://github.com/org/app/pull/${number}`,
  repo: "org/app",
  author: "maintainer",
  mergedAt: new Date(Date.UTC(2026, 8, number)),
  additions: 10,
  deletions: 2,
  tasks: [],
  ...over,
});

describe("classify", () => {
  it("reads conventional commit types, scopes and breaking markers", () => {
    expect(classify("feat(api): add retries")).toEqual({ kind: "feature", scope: "api", breaking: false, text: "Add retries" });
    expect(classify("fix!: drop legacy tokens")).toMatchObject({ kind: "fix", breaking: true, text: "Drop legacy tokens" });
    expect(classify("refactor: split module\n\nBREAKING CHANGE: new import path")).toMatchObject({ kind: "internal", breaking: true });
    expect(classify("chore(deps): bump vite")).toMatchObject({ kind: "maintenance", scope: "deps" });
  });
  it("keeps titles without a known type as written", () => {
    expect(classify("Improve onboarding copy")).toEqual({ kind: "other", scope: null, breaking: false, text: "Improve onboarding copy" });
    expect(classify("wip: experiment")).toEqual({ kind: "other", scope: null, breaking: false, text: "wip: experiment" });
  });
});

describe("buildChangelog", () => {
  it("groups in a fixed order, puts breaking first, credits humans, and adds uncovered tasks", () => {
    const c = buildChangelog(
      [
        pr(3, "fix: handle expired cookies", { tasks: ["APP-7"] }),
        pr(1, "feat(search): ranked results", { author: "ari", additions: 100, deletions: 20 }),
        pr(2, "feat!: new config format"),
        pr(4, "chore(deps): bump fastify", { author: "dependabot[bot]" }),
      ],
      [
        { identifier: "APP-7", title: "Session crash", completedAt: new Date(Date.UTC(2026, 8, 3)) },
        { identifier: "APP-9", title: "Write the launch checklist", completedAt: new Date(Date.UTC(2026, 8, 5)) },
      ],
      { includeTasks: true },
    );
    expect(c.sections.map((s) => s.title)).toEqual(["Breaking changes", "Features", "Fixes", "Maintenance", "Completed tasks"]);
    expect(c.sections[1]!.items.map((i) => i.pr?.number)).toEqual([1]);
    // The task covered by PR #3 is not listed twice.
    expect(c.sections.at(-1)!.items.map((i) => i.tasks[0])).toEqual(["APP-9"]);
    expect(c.contributors).toEqual(["ari", "maintainer"]);
    expect(c.stats).toEqual({ pullRequests: 4, tasks: 2, contributors: 2, additions: 130, deletions: 26 });
  });

  it("leaves tasks out for people who cannot see them", () => {
    const c = buildChangelog([pr(1, "fix: x")], [{ identifier: "APP-1", title: "Private task", completedAt: new Date() }], { includeTasks: false });
    expect(c.sections.map((s) => s.kind)).toEqual(["fix"]);
    expect(c.stats.tasks).toBe(0);
  });

  it("renders markdown with references, scopes, and no em dashes", () => {
    const c = buildChangelog([pr(1, "feat(api): add retries", { author: "ari" }), pr(2, "fix: typo", { author: "renovate" })], [], { includeTasks: true });
    const md = changelogMarkdown(c, { multiRepo: false });
    expect(md).toBe(["## Features", "", "- **api:** Add retries (#1) by @ari", "", "## Fixes", "", "- Typo (#2)", "", "## Contributors", "", "@ari"].join("\n"));
    expect(md).not.toMatch(/—/);
    expect(changelogMarkdown(c, { multiRepo: true })).toContain("(org/app#1)");
  });
});
