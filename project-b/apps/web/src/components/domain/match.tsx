import type { MatchReason, PersonCard } from "@bldt/contracts";
import Link from "next/link";
import { Avatar, Badge } from "@/components/ui/misc";
import { cn, plural } from "@/lib/utils";
import { TechChip, TrustMark } from "./status";

/** "Matches Go, PostgreSQL (1 with their own commits)": the reason, not a score. */
export function MatchLine({ reason, subject = "their" }: { reason: MatchReason; subject?: "their" | "your" }) {
  const names = reason.technologies.map((t) => t.name);
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted">
      <span>Matches {shown}</span>
      {reason.evidenced > 0 && (
        <span className="flex items-center gap-1 text-faint">
          · <TrustMark trust="CONNECTED" /> {reason.evidenced} backed by {subject} commits
        </span>
      )}
    </p>
  );
}

export function PersonCardView({ p, footer, className }: { p: PersonCard; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col rounded-lg border border-border bg-surface p-4", className)}>
      <div className="flex items-start gap-3">
        <Avatar user={p} size={36} />
        <div className="min-w-0 flex-1">
          <Link href={`/${p.username}`} className="block truncate text-sm font-medium hover:underline">
            {p.displayName}
          </Link>
          <p className="truncate text-xs text-faint">
            @{p.username}
            {p.location && <> · {p.location}</>}
          </p>
        </div>
        {p.openToWork && <Badge tone="success">Open to work</Badge>}
      </div>
      {p.headline && <p className="mt-2 line-clamp-2 text-sm text-muted">{p.headline}</p>}
      {p.technologies.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {p.technologies.slice(0, 5).map((t) => (
            <TechChip key={t.slug} tech={t} className={t.evidenced ? "border-border-strong text-fg" : ""} />
          ))}
        </div>
      )}
      <p className="mt-auto pt-3 text-xs text-faint tnum">
        {plural(p.publicProjects, "public project")}
        {p.shipped > 0 && <> · {p.shipped} shipped</>}
        {p.mergedPrs > 0 && <> · {plural(p.mergedPrs, "PR")} merged</>}
      </p>
      {footer}
    </div>
  );
}
