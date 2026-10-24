"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/choice";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

/** Markdown with a preview tab. Cmd/Ctrl+Enter submits, so replies never need the mouse. */
export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 6,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  label: string;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  return (
    <div className="rounded-md border border-border bg-surface focus-within:border-border-strong">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }]} />
        <span className="hidden text-2xs text-faint sm:block">Markdown · @mention teammates</span>
      </div>
      {tab === "write" ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={rows}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={label}
          className="block w-full resize-y rounded-none border-0 bg-transparent focus-visible:outline-none"
        />
      ) : (
        <div className={cn("min-h-24 px-3 py-2.5", !value.trim() && "text-sm text-faint")}>{value.trim() ? <Markdown>{value}</Markdown> : "Nothing to preview."}</div>
      )}
    </div>
  );
}
