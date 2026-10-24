import { createHash } from "node:crypto";

/**
 * Recognise "the same error" across machines, users and edits, without guessing. We keep what
 * identifies the failure (the error type and message wording, module and symbol names) and strip
 * what varies run to run (paths, line and column numbers, ids, hashes, ports, timestamps, values).
 *
 * Two people hitting `TypeError: Cannot read properties of undefined (reading 'id')` at different
 * lines of different checkouts get the same fingerprint; a different property name does not.
 */

const MAX_INPUT = 20_000;

/** The line that names the failure: skip blank lines, stack frames and runner noise. */
export function errorHeadline(raw: string): string {
  const lines = raw.slice(0, MAX_INPUT).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isFrame = (l: string) =>
    /^at\s/.test(l) || // JS, Java, C#
    /^File ".*", line \d+/.test(l) || // Python
    /^\d+:\s+0x[0-9a-f]+/i.test(l) || // Rust backtrace
    /^(goroutine \d+|\S+\.go:\d+)/.test(l) || // Go
    /^Traceback \(most recent call last\)/.test(l) ||
    /^\^+$/.test(l) || /^~+$/.test(l);
  // Prefer a line that looks like "SomethingError: message" or "error[E0382]: message".
  const named = lines.find((l) => !isFrame(l) && /^(?:[\w$.]*(?:Error|Exception|Panic|Fault)|error(?:\[\w+\])?|panic|fatal|E\d{4})\b.*:/i.test(l));
  return named ?? lines.find((l) => !isFrame(l)) ?? "";
}

export function normalizeError(raw: string): string {
  let s = errorHeadline(raw);
  // Drop ANSI colours a terminal paste carries.
  s = s.replace(/\u001b\[[0-9;]*m/g, "");
  s = s.replace(/\bhttps?:\/\/\S+/g, "<url>");
  // Paths: keep only the file name (often meaningful, e.g. a missing module), drop directories.
  s = s.replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@+-]+)+[\\/]([\w.@+-]+)/g, "$1");
  // file.ts:12:5 -> file.ts
  s = s.replace(/([\w.-]+\.[a-z]{1,5}):\d+(?::\d+)?/gi, "$1");
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>");
  s = s.replace(/\b0x[0-9a-f]+\b/gi, "<hex>");
  s = s.replace(/\b[0-9a-f]{12,}\b/gi, "<hex>");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?\b/g, "<time>");
  s = s.replace(/\b\d+(\.\d+)?\b/g, "<n>");
  // Long quoted values are data (a JSON body, a SQL statement); short ones are names worth keeping.
  s = s.replace(/(["'`])([^"'`]{41,})\1/g, "$1<value>$1");
  return s.replace(/\s+/g, " ").trim();
}

/** 16 hex chars: stable, short enough for an index, collision-safe at project scale. */
export function errorFingerprint(raw: string): string | null {
  const n = normalizeError(raw);
  if (n.length < 6) return null;
  return createHash("sha256").update(n).digest("hex").slice(0, 16);
}
