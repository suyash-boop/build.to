import type { DiscussionSummary } from "@bldt/contracts";
import { CircleCheck, LifeBuoy, Lightbulb, Megaphone, MessagesSquare, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Category = DiscussionSummary["category"];

export const CATEGORY: Record<Category, { label: string; icon: LucideIcon; hint: string }> = {
  GENERAL: { label: "General", icon: MessagesSquare, hint: "Anything about the project." },
  HELP: { label: "Help", icon: LifeBuoy, hint: "Stuck on an error or a question. Mark the reply that fixed it." },
  IDEAS: { label: "Ideas", icon: Lightbulb, hint: "Proposals and feature ideas to discuss before they become tasks." },
  ANNOUNCEMENTS: { label: "Announcements", icon: Megaphone, hint: "Updates from maintainers. Everyone is notified." },
};

export function CategoryIcon({ category, solved, className }: { category: Category; solved?: boolean; className?: string }) {
  if (category === "HELP" && solved) return <CircleCheck className={cn("size-4 shrink-0 text-success", className)} aria-label="Solved" />;
  const Icon = CATEGORY[category].icon;
  return <Icon className={cn("size-4 shrink-0 text-faint", category === "HELP" && "text-warning", className)} aria-label={CATEGORY[category].label} />;
}
