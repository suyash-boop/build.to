"use client";

import { m } from "motion/react";
import { IntentLink } from "@/components/ui/intent-link";
import { usePathname } from "next/navigation";
import { indicatorSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function DiscoverTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/discover", label: "Projects" },
    { href: "/discover/people", label: "People" },
  ];
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="Discover sections">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <IntentLink
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("transition-ui relative px-2.5 pb-2.5 pt-1 text-sm", active ? "font-medium text-fg" : "text-muted hover:text-fg")}
          >
            {t.label}
            {active && <m.span layoutId="discover-tab" transition={indicatorSpring} className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-t bg-fg" aria-hidden />}
          </IntentLink>
        );
      })}
    </nav>
  );
}
