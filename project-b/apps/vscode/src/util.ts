/** Pure helpers: no VS Code imports, so they are unit tested directly. */

/** owner/repo from any GitHub remote form: https, ssh, scp-like, with or without .git. */
export function parseGithubRemote(url: string): string | null {
  const m =
    /^(?:https?:\/\/|ssh:\/\/|git:\/\/)(?:[^@/]+@)?github\.com(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim()) ??
    /^[\w.-]+@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function slugify(s: string, max = 40): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > max ? slug.slice(0, max).replace(/-[^-]*$/, "") || slug.slice(0, max) : slug;
}

/**
 * Branch for a task: `raj/relay-7-live-rate-chart`. The identifier is in it, so bld.t links the
 * pull request to the task when it is opened.
 */
export function branchName(username: string, identifier: string, title: string): string {
  const prefix = `${slugify(username, 39)}/${identifier.toLowerCase()}`;
  const rest = slugify(title, Math.max(8, 60 - prefix.length - 1));
  return rest ? `${prefix}-${rest}` : prefix;
}

/** The task a branch is about: the first KEY-123 (any case) whose key belongs to the project. */
export function identifierFromBranch(branch: string, keys: string[]): { key: string; number: number } | null {
  const wanted = new Set(keys.map((k) => k.toUpperCase()));
  for (const m of branch.matchAll(/(?:^|[^a-z0-9])([a-z][a-z0-9]{0,9})-(\d{1,7})(?=$|[^0-9])/gi)) {
    const key = m[1]!.toUpperCase();
    if (wanted.has(key)) return { key, number: Number(m[2]) };
  }
  return null;
}

/** A short title for a help thread from the error text. */
export function errorTitle(message: string): string {
  const line = message.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "Error";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/** Workspace-relative path with forward slashes, or null when outside the repository. */
export function relativePath(root: string, file: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const f = norm(file);
  const same = process.platform === "win32" ? f.toLowerCase().startsWith(r.toLowerCase() + "/") : f.startsWith(r + "/");
  return same ? f.slice(r.length + 1) : null;
}

/** The lines around a position, numbered, for context in a help request. */
export function snippet(text: string, line: number, radius = 5): string {
  const lines = text.split(/\r?\n/);
  const from = Math.max(0, line - 1 - radius);
  const to = Math.min(lines.length, line + radius);
  const width = String(to).length;
  return lines
    .slice(from, to)
    .map((l, i) => `${String(from + i + 1).padStart(width)}${from + i + 1 === line ? " >" : "  "} ${l}`)
    .join("\n")
    .slice(0, 4_900);
}

/**
 * The bld.t address as typed into settings or the sign-in prompt, normalized (no trailing slash).
 * Tokens are sent to this address, so it must be https; plain http is only for a local server.
 */
export function normalizeBaseUrl(input: string): { url: string } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Enter your bld.t address." };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "Enter the full address, starting with https://." };
  }
  if (u.username || u.password) return { error: "Leave out the user name and password." };
  if (u.search || u.hash) return { error: "Enter just the address, without ? or #." };
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return { error: "Use https://. Plain http:// is allowed only for localhost and 127.0.0.1." };
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}

/**
 * Collapse bursts of calls into one: runs `settleMs` after the last call, and never sooner than
 * `minGapMs` after the previous run. Used so a flapping connection does not refetch everything each time.
 */
export function coalesce(fn: () => void, settleMs: number, minGapMs: number): { (): void; cancel(): void } {
  let lastRun = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    const wait = Math.max(settleMs, lastRun + minGapMs - Date.now());
    timer = setTimeout(() => {
      timer = null;
      lastRun = Date.now();
      fn();
    }, wait);
  };
  trigger.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return trigger;
}
