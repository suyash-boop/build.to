import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * EmptyState — an invitation to act, not a dead end (PRD §8.8). e.g.
 * "No posts yet — write your first one." with an action button as `action`.
 */
export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-large border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <p className="text-l font-medium text-body">{title}</p>
      {description && <p className="max-w-sm text-secondary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
