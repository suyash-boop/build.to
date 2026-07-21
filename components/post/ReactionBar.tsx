"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleReaction } from "@/app/actions/reactions";
import { cn } from "@/lib/utils";
import type { ReactionCategory } from "@prisma/client";

const REACTIONS: {
  category: ReactionCategory;
  emoji: string;
  label: string;
}[] = [
  { category: "LIKE", emoji: "❤️", label: "Like" },
  { category: "UNICORN", emoji: "🦄", label: "Unicorn" },
  { category: "FIRE", emoji: "🔥", label: "Fire" },
  { category: "EXPLODING_HEAD", emoji: "🤯", label: "Mind-blown" },
  { category: "BOOKMARK", emoji: "🔖", label: "Save" },
];

export interface ReactionBarProps {
  postId: string;
  signedIn: boolean;
  initialCounts: Record<ReactionCategory, number>;
  initialMine: ReactionCategory[];
  /** Horizontal on mobile / sticky footer, vertical in the desktop left rail. */
  orientation?: "vertical" | "horizontal";
}

export function ReactionBar({
  postId,
  signedIn,
  initialCounts,
  initialMine,
  orientation = "vertical",
}: ReactionBarProps) {
  const router = useRouter();
  const [counts, setCounts] = useState(initialCounts);
  const [mine, setMine] = useState(new Set(initialMine));
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleToggle(category: ReactionCategory) {
    if (!signedIn) {
      router.push("/login");
      return;
    }

    // Optimistic: flip immediately, roll back if the server disagrees (§5.7).
    const wasActive = mine.has(category);
    const prevCounts = counts;
    const prevMine = new Set(mine);

    const nextMine = new Set(mine);
    if (wasActive) nextMine.delete(category);
    else nextMine.add(category);
    setMine(nextMine);
    setCounts({
      ...counts,
      [category]: Math.max(0, counts[category] + (wasActive ? -1 : 1)),
    });
    setError(null);

    const result = await toggleReaction(postId, "POST", category);

    if (!result.ok) {
      setCounts(prevCounts);
      setMine(prevMine);
      setError(result.error);
      return;
    }

    // Reconcile with the server's authoritative count.
    setCounts((c) => ({ ...c, [category]: result.count }));
    startTransition(() => router.refresh());
  }

  return (
    <div
      className={cn(
        "flex gap-1",
        orientation === "vertical" ? "flex-col items-center" : "items-center",
      )}
    >
      {REACTIONS.map(({ category, emoji, label }) => {
        const active = mine.has(category);
        return (
          <button
            key={category}
            type="button"
            onClick={() => handleToggle(category)}
            aria-pressed={active}
            aria-label={`${label}${active ? " (active)" : ""}`}
            title={label}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-2 text-s transition-colors",
              active
                ? "bg-brand/10 text-brand"
                : "text-secondary hover:bg-base-bg",
              orientation === "vertical" && "flex-col gap-0.5",
            )}
          >
            <span className="text-l leading-none">{emoji}</span>
            <span className="tabular-nums">{counts[category]}</span>
          </button>
        );
      })}
      {error && (
        <p role="alert" className="text-s text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
