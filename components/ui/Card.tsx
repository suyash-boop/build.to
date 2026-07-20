import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

/**
 * Card — 1px border, no shadow in the default state (PRD §8.5). This flat,
 * document-like surface is a defining detail of the dev.to look. Pass
 * `hover` to opt into a hover shadow (used by clickable cards like PostCard).
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ hover = false, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-large border border-border bg-body-bg",
        hover && "transition-shadow hover:shadow-md",
        className,
      )}
      {...props}
    />
  );
}
