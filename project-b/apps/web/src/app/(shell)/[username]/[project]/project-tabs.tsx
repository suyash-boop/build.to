"use client";

import { m } from "motion/react";
import { IntentLink } from "@/components/ui/intent-link";
import { usePathname } from "next/navigation";
import { indicatorSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function ProjectTabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav className="-mb-px mt-4 flex gap-1 overflow-x-auto" aria-label="Project sections">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <IntentLink
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "transition-ui relative whitespace-nowrap px-2.5 pb-2.5 pt-1 text-sm",
              active ? "font-medium text-fg" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
            {active && <m.span layoutId="project-tab" transition={indicatorSpring} className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-t bg-fg" aria-hidden />}
          </IntentLink>
        );
      })}
    </nav>
  );
}
