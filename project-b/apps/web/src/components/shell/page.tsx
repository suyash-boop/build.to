import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Consistent page chrome: a 48px header bar with title and actions, then content. */
export function PageHeader({ title, children, actions, className }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-16 z-20 hidden h-16 items-center gap-3 border-b border-border bg-surface/95 px-6 backdrop-blur md:flex in-[.public-shell]:md:hidden", className)}>
      <h1 className="min-w-0 truncate text-base font-semibold tracking-tight text-fg">{title}</h1>
      {children}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
  );
}

/** Mobile gets the title inline since the sticky bar is reserved for navigation. */
export function MobileTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 md:hidden">
      <h1 className="text-base font-semibold">{children}</h1>
      {actions}
    </div>
  );
}

export function PageBody({ children, className, width = "wide" }: { children: ReactNode; className?: string; width?: "narrow" | "medium" | "wide" | "full" }) {
  const max = { narrow: "max-w-2xl", medium: "max-w-4xl", wide: "max-w-6xl", full: "max-w-none" }[width];
  return <div className={cn("mx-auto w-full px-4 py-5 md:px-6 md:py-6", max, className)}>{children}</div>;
}
