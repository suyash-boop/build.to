/** Server-safe pieces: usable from server components and client components alike. */

/* ── Stat tile ─────────────────────────────────────────────── */

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-2xs text-faint">{label}</p>
      <p className="mt-1 text-xl font-semibold tnum">{value}</p>
      {hint && <p className="mt-0.5 text-2xs text-muted">{hint}</p>}
    </div>
  );
}

/** Hours -> "3.2h", "4.5d", "2.1w". */
export function formatDuration(hours: number | null): string {
  if (hours == null) return "n/a";
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const d = hours / 24;
  if (d < 14) return `${d.toFixed(1)}d`;
  return `${(d / 7).toFixed(1)}w`;
}
