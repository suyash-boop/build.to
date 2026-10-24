export interface TaskReference {
  key: string;
  number: number;
  /** A closing keyword precedes the reference ("fixes RELAY-12"). */
  closes: boolean;
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[\s:]*$/i;

/**
 * Find task identifiers such as RELAY-12 in a PR title, body, or branch name.
 *
 * Only keys belonging to projects linked to the repository are matched, so arbitrary
 * uppercase tokens (UTF-8, ISO-8601) are not mistaken for tasks. Branch names are matched
 * case-insensitively because git branches are conventionally lowercase (relay-12-fix-timeout).
 */
export function parseTaskReferences(
  input: { title?: string | null; body?: string | null; branch?: string | null },
  keys: Iterable<string>,
): TaskReference[] {
  const keySet = new Set([...keys].map((k) => k.toUpperCase()));
  if (keySet.size === 0) return [];

  const found = new Map<string, TaskReference>();
  const add = (key: string, number: number, closes: boolean) => {
    const id = `${key}-${number}`;
    const prev = found.get(id);
    found.set(id, { key, number, closes: closes || (prev?.closes ?? false) });
  };

  const scanText = (text: string) => {
    // Strip fenced and inline code so examples in PR descriptions do not create links.
    const clean = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
    const re = /(?<![A-Za-z0-9_/-])([A-Z][A-Z0-9]{1,9})-(\d{1,7})(?![A-Za-z0-9_])/g;
    for (const m of clean.matchAll(re)) {
      const key = m[1] as string;
      if (!keySet.has(key)) continue;
      const number = Number(m[2]);
      if (number < 1) continue;
      const before = clean.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
      add(key, number, CLOSING.test(before));
    }
  };

  if (input.title) scanText(input.title);
  if (input.body) scanText(input.body);

  if (input.branch) {
    const re = /(?:^|[/_-])([a-z][a-z0-9]{1,9})-(\d{1,7})(?=$|[/_-])/gi;
    for (const m of input.branch.matchAll(re)) {
      const key = (m[1] as string).toUpperCase();
      if (!keySet.has(key)) continue;
      const number = Number(m[2]);
      if (number >= 1) add(key, number, false);
    }
  }

  return [...found.values()];
}
