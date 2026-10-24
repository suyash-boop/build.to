"use client";

import { Check } from "lucide-react";
import { m } from "motion/react";
import { useId, type ReactNode } from "react";
import { indicatorSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Segmented control for 2 to 4 mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  // Each control instance needs its own layout id so thumbs never fly between controls.
  const id = useId();
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-md border border-border bg-bg-subtle p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "transition-ui relative inline-flex items-center gap-1.5 rounded-[5px] px-2.5 font-medium",
            size === "sm" ? "h-6 text-xs" : "h-7 text-sm",
            value === o.value ? "text-fg" : "text-muted hover:text-fg",
          )}
        >
          {value === o.value && (
            <m.span
              layoutId={`seg-${id}`}
              transition={indicatorSpring}
              className="absolute inset-0 rounded-[5px] bg-surface shadow-[0_0_0_1px_var(--border)]"
              aria-hidden
            />
          )}
          <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Radio cards with a title and explanation, for choices that need context (visibility). */
export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  name,
}: {
  value: T;
  onChange: (v: T) => void;
  name: string;
  options: { value: T; title: string; description: string; icon?: ReactNode }[];
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
              selected ? "border-border-strong bg-surface-hover" : "border-border hover:border-border-strong",
            )}
          >
            {o.icon && <span className="mt-0.5 text-muted">{o.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{o.title}</span>
              <span className="block text-xs text-muted">{o.description}</span>
            </span>
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-fg bg-fg text-bg" : "border-border-strong",
              )}
            >
              {selected && <Check className="size-2.5" strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:opacity-40",
        checked ? "border-fg bg-fg text-bg" : "border-border-strong bg-surface hover:border-muted",
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "transition-ui relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-[5px] border disabled:opacity-50",
        checked ? "border-fg bg-fg" : "border-border-strong bg-surface-2",
      )}
    >
      <span className={cn("size-3 rounded-[3px] transition-transform duration-200 ease-[var(--ease-out)]", checked ? "translate-x-[15px] bg-bg" : "translate-x-[2px] bg-muted")} />
    </button>
  );
}
