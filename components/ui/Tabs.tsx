"use client";

import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

/**
 * Controlled tab bar (Edit/Preview in the editor, Latest/Relevant in the feed).
 * State lives in the parent so the panel content is the parent's concern.
 */
export function Tabs({ tabs, value, onValueChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-1 border-b border-border", className)}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onValueChange(tab.value)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-base font-medium transition-colors",
              active
                ? "border-brand text-body"
                : "border-transparent text-secondary hover:text-body",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
