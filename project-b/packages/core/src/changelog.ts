/**
 * Changelogs built from what actually merged: pull requests grouped by their conventional-commit
 * type, plus completed tasks no listed pull request already covers. Deterministic: the same inputs
 * always produce the same changelog, and every line points at its source.
 */

export interface ChangelogPr {
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string | null;
  mergedAt: Date;
  additions: number;
  deletions: number;
  /** Task identifiers this pull request is linked to. */
  tasks: string[];
}

export interface ChangelogTask {
  identifier: string;
  title: string;
  completedAt: Date;
}

export type ChangelogKind = "breaking" | "feature" | "fix" | "performance" | "docs" | "internal" | "maintenance" | "revert" | "other" | "tasks";

export interface ChangelogItem {
  text: string;
  scope: string | null;
  pr: { number: number; url: string; repo: string } | null;
  author: string | null;
  tasks: string[];
}

export interface ChangelogSection {
  kind: ChangelogKind;
  title: string;
  items: ChangelogItem[];
}

export interface Changelog {
  sections: ChangelogSection[];
  contributors: string[];
  stats: { pullRequests: number; tasks: number; contributors: number; additions: number; deletions: number };
}

const TYPE_TO_KIND: Record<string, ChangelogKind> = {
  feat: "feature",
  feature: "feature",
  fix: "fix",
  bugfix: "fix",
  hotfix: "fix",
  perf: "performance",
  docs: "docs",
  doc: "docs",
  refactor: "internal",
  style: "internal",
  test: "maintenance",
  tests: "maintenance",
  ci: "maintenance",
  build: "maintenance",
  chore: "maintenance",
  deps: "maintenance",
  revert: "revert",
};

const SECTION_ORDER: { kind: ChangelogKind; title: string }[] = [
  { kind: "breaking", title: "Breaking changes" },
  { kind: "feature", title: "Features" },
  { kind: "fix", title: "Fixes" },
  { kind: "performance", title: "Performance" },
  { kind: "other", title: "Changes" },
  { kind: "docs", title: "Documentation" },
  { kind: "internal", title: "Internal" },
  { kind: "maintenance", title: "Maintenance" },
  { kind: "revert", title: "Reverts" },
  { kind: "tasks", title: "Completed tasks" },
];

const CONVENTIONAL = /^\s*([a-z]+)(?:\(([^)]{1,40})\))?(!)?\s*:\s*(.+)$/i;

export function isBot(login: string | null) {
  return !!login && (/\[bot\]$/i.test(login) || /^(dependabot|renovate|github-actions)(-preview)?$/i.test(login));
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "feat(api)!: add retries" -> kind feature, scope api, breaking, text "Add retries". */
export function classify(title: string): { kind: ChangelogKind; scope: string | null; breaking: boolean; text: string } {
  const breakingNote = /BREAKING[ -]CHANGE/.test(title);
  const firstLine = title.split(/\r?\n/)[0]!.trim();
  const m = CONVENTIONAL.exec(firstLine);
  if (!m) return { kind: "other", scope: null, breaking: breakingNote, text: capitalize(firstLine) };
  const kind = TYPE_TO_KIND[m[1]!.toLowerCase()];
  // An unknown prefix ("wip: x") is not a type; keep the title exactly as written.
  if (!kind) return { kind: "other", scope: null, breaking: Boolean(m[3]) || breakingNote, text: firstLine };
  return { kind, scope: m[2]?.trim() ?? null, breaking: Boolean(m[3]) || breakingNote, text: capitalize(m[4]!.trim()) };
}

export function buildChangelog(prs: ChangelogPr[], tasks: ChangelogTask[], opts: { includeTasks: boolean }): Changelog {
  const buckets = new Map<ChangelogKind, ChangelogItem[]>();
  const add = (kind: ChangelogKind, item: ChangelogItem) => buckets.set(kind, [...(buckets.get(kind) ?? []), item]);
  const covered = new Set<string>();
  const contributors = new Set<string>();
  let additions = 0;
  let deletions = 0;

  for (const pr of [...prs].sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime() || a.number - b.number)) {
    const c = classify(pr.title);
    const item: ChangelogItem = { text: c.text, scope: c.scope, pr: { number: pr.number, url: pr.url, repo: pr.repo }, author: pr.author, tasks: pr.tasks };
    add(c.breaking ? "breaking" : c.kind, item);
    for (const t of pr.tasks) covered.add(t);
    if (pr.author && !isBot(pr.author)) contributors.add(pr.author);
    additions += pr.additions;
    deletions += pr.deletions;
  }

  let taskCount = 0;
  if (opts.includeTasks) {
    for (const t of [...tasks].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime())) {
      taskCount++;
      if (covered.has(t.identifier)) continue;
      add("tasks", { text: t.title, scope: null, pr: null, author: null, tasks: [t.identifier] });
    }
  }

  const sections = SECTION_ORDER.flatMap(({ kind, title }) => {
    const items = buckets.get(kind);
    return items?.length ? [{ kind, title, items }] : [];
  });
  const names = [...contributors].sort((a, b) => a.localeCompare(b));
  return { sections, contributors: names, stats: { pullRequests: prs.length, tasks: taskCount, contributors: names.length, additions, deletions } };
}

/** Markdown for a GitHub release or a bld.t release record. No em dashes, no decoration. */
export function changelogMarkdown(c: Changelog, opts: { multiRepo: boolean }): string {
  const lines: string[] = [];
  for (const s of c.sections) {
    lines.push(`## ${s.title}`, "");
    for (const i of s.items) {
      const scope = i.scope ? `**${i.scope}:** ` : "";
      const ref = i.pr ? (opts.multiRepo ? ` (${i.pr.repo}#${i.pr.number})` : ` (#${i.pr.number})`) : "";
      const by = i.author && !isBot(i.author) ? ` by @${i.author}` : "";
      const tasks = !i.pr && i.tasks.length ? `${i.tasks.join(", ")} ` : "";
      lines.push(`- ${tasks}${scope}${i.text}${ref}${by}`);
    }
    lines.push("");
  }
  if (c.contributors.length) lines.push("## Contributors", "", c.contributors.map((n) => `@${n}`).join(", "), "");
  return lines.join("\n").trim();
}
