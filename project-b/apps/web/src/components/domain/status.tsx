import { PRIORITY_LABEL, STAGE_LABEL, STATUS_LABEL, type ProjectStage, type TaskPriority, type TaskStatus, type TrustLevel } from "@bldt/contracts";
import { cn } from "@/lib/utils";

const STAGE_VAR: Record<ProjectStage, string> = {
  IDEA: "var(--st-idea)",
  BUILDING: "var(--st-building)",
  SHIPPED: "var(--st-shipped)",
  MAINTAINED: "var(--st-maintained)",
  PAUSED: "var(--st-paused)",
  SUNSET: "var(--st-sunset)",
};

/** Project lifecycle stage. A shape plus a word, so it never relies on color alone. */
export function StageBadge({ stage, className }: { stage: ProjectStage; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 items-center gap-1.5 rounded-sm border border-border px-1.5 text-2xs font-medium text-muted", className)}
    >
      <StageGlyph stage={stage} />
      {STAGE_LABEL[stage]}
    </span>
  );
}

export function StageGlyph({ stage, size = 8 }: { stage: ProjectStage; size?: number }) {
  const c = STAGE_VAR[stage];
  const s = size;
  if (stage === "IDEA") return <svg width={s} height={s} viewBox="0 0 8 8" aria-hidden><circle cx="4" cy="4" r="3" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="1.6 1.4" /></svg>;
  if (stage === "BUILDING") return <svg width={s} height={s} viewBox="0 0 8 8" aria-hidden><circle cx="4" cy="4" r="3" fill="none" stroke={c} strokeWidth="1.5" /><path d="M4 1a3 3 0 0 1 0 6z" fill={c} /></svg>;
  if (stage === "PAUSED") return <svg width={s} height={s} viewBox="0 0 8 8" aria-hidden><rect x="1.5" y="1" width="1.6" height="6" rx=".5" fill={c} /><rect x="4.9" y="1" width="1.6" height="6" rx=".5" fill={c} /></svg>;
  if (stage === "SUNSET") return <svg width={s} height={s} viewBox="0 0 8 8" aria-hidden><circle cx="4" cy="4" r="3" fill="none" stroke={c} strokeWidth="1.5" /><path d="M1.8 6.2 6.2 1.8" stroke={c} strokeWidth="1.5" /></svg>;
  return <svg width={s} height={s} viewBox="0 0 8 8" aria-hidden><circle cx="4" cy="4" r="3.5" fill={c} /></svg>;
}

/** Task status: a ring that fills as work progresses. Same visual grammar as the stage glyphs. */
export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", className: cn("shrink-0", className), "aria-label": STATUS_LABEL[status], role: "img" } as const;
  switch (status) {
    case "BACKLOG":
      return <svg {...common}><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--text-faint)" strokeWidth="1.5" strokeDasharray="2 2" /></svg>;
    case "TODO":
      return <svg {...common}><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" /></svg>;
    case "IN_PROGRESS":
      return <svg {...common}><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--st-paused)" strokeWidth="1.5" /><path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="var(--st-paused)" /></svg>;
    case "IN_REVIEW":
      return <svg {...common}><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--st-building)" strokeWidth="1.5" /><path d="M7 3.5a3.5 3.5 0 1 1-3.5 3.5H7z" fill="var(--st-building)" /></svg>;
    case "DONE":
      return <svg {...common}><circle cx="7" cy="7" r="6.25" fill="var(--st-shipped)" /><path d="m4.3 7.2 1.8 1.8 3.6-3.8" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "CANCELED":
      return <svg {...common}><circle cx="7" cy="7" r="6.25" fill="var(--text-faint)" /><path d="m5 5 4 4M9 5 5 9" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  }
}

/** Priority as signal bars; urgent is a filled square with an exclamation. */
export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", className: cn("shrink-0", className), role: "img", "aria-label": PRIORITY_LABEL[priority] } as const;
  if (priority === "NONE") {
    return <svg {...common}><g fill="var(--text-faint)"><rect x="2" y="6.25" width="2.5" height="1.5" rx=".5" /><rect x="5.75" y="6.25" width="2.5" height="1.5" rx=".5" /><rect x="9.5" y="6.25" width="2.5" height="1.5" rx=".5" /></g></svg>;
  }
  if (priority === "URGENT") {
    return <svg {...common}><rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill="var(--accent)" /><path d="M7 4v3.6" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" /><circle cx="7" cy="9.9" r=".9" fill="var(--bg)" /></svg>;
  }
  const level = { LOW: 1, MEDIUM: 2, HIGH: 3 }[priority];
  return (
    <svg {...common}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2 + i * 3.75} y={9 - i * 3} width="2.5" height={3.5 + i * 3} rx=".6" fill={i < level ? "var(--text-muted)" : "var(--border-strong)"} />
      ))}
    </svg>
  );
}

const TRUST_COPY: Record<TrustLevel, string> = {
  CONNECTED: "Verified from GitHub",
  PLATFORM: "Recorded on bld.t",
  SELF_REPORTED: "Self-reported",
};

/** Marks where a piece of evidence came from. Shown next to every claim on profiles. */
export function TrustMark({ trust, className }: { trust: TrustLevel; className?: string }) {
  return (
    <span title={TRUST_COPY[trust]} aria-label={TRUST_COPY[trust]} className={cn("inline-flex items-center", className)}>
      {trust === "CONNECTED" ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M6 .8 7.4 2l1.8-.2.5 1.8 1.6.9-.6 1.7.6 1.7-1.6.9-.5 1.8-1.8-.2L6 11.2 4.6 10l-1.8.2-.5-1.8-1.6-.9.6-1.7-.6-1.7 1.6-.9.5-1.8L4.6 2z" fill="var(--st-shipped)" opacity=".18" />
          <path d="m3.8 6.1 1.5 1.5 2.9-3" fill="none" stroke="var(--st-shipped)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : trust === "PLATFORM" ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--text-faint)" strokeWidth="1.3" /><circle cx="6" cy="6" r="1.6" fill="var(--text-faint)" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--text-faint)" strokeWidth="1.3" strokeDasharray="1.5 1.5" /></svg>
      )}
    </span>
  );
}

export function TechChip({ tech, className }: { tech: { name: string; color: string | null; category?: string }; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-sm border border-border px-1.5 text-2xs text-muted", className)}>
      {tech.color ? (
        <span className="size-2 rounded-full" style={{ background: tech.color }} aria-hidden />
      ) : (
        <span className="size-2 rounded-[2px] border border-border-strong" aria-hidden />
      )}
      {tech.name}
    </span>
  );
}
