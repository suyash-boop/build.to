"use client";

import { PRIORITY_LABEL, STATUS_LABEL, type MemberItem, type MilestoneSummary, type TaskPriority, type TaskStatus, type UserRef } from "@bldt/contracts";
import { Command } from "cmdk";
import { CalendarDays, Check, Flag, UserRound, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { PriorityIcon, StatusIcon } from "@/components/domain/status";
import { Avatar } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { useNow } from "@/lib/use-now";
import { cn, dueState, shortDate } from "@/lib/utils";

export const STATUS_ORDER: TaskStatus[] = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELED"];
export const PRIORITY_ORDER: TaskPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];

interface Option<V> {
  value: V;
  label: string;
  icon: ReactNode;
  search?: string;
}

/** Searchable property picker: type to filter, arrows to move, enter to choose. */
function Picker<V extends string | null>({
  value,
  options,
  onChange,
  trigger,
  placeholder,
  disabled,
  align = "start",
}: {
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  trigger: ReactNode;
  placeholder: string;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      {/* Portaled, but React events still bubble to the task card: keep clicks, pointers and
          keys (Enter, Space) here from opening the task or starting a drag. */}
      <PopoverContent
        align={align}
        className="w-56 p-0"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Command loop>
          <Command.Input
            placeholder={placeholder}
            autoFocus
            className="h-9 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-faint"
          />
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-2 py-3 text-center text-xs text-muted">No matches</Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={String(o.value)}
                value={`${o.label} ${o.search ?? ""}`}
                onSelect={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm data-[selected=true]:bg-surface-hover"
              >
                <span className="flex w-4 justify-center">{o.icon}</span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === value && <Check className="size-3.5 text-muted" />}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const triggerCls = "inline-flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-sm text-fg hover:bg-surface-hover disabled:pointer-events-none";

export function StatusPicker({ value, onChange, compact, disabled }: { value: TaskStatus; onChange: (s: TaskStatus) => void; compact?: boolean; disabled?: boolean }) {
  return (
    <Picker
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder="Change status"
      options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s], icon: <StatusIcon status={s} /> }))}
      trigger={
        <button type="button" className={cn(triggerCls, compact && "h-6 w-6 justify-center px-0")} aria-label={`Status: ${STATUS_LABEL[value]}`}>
          <StatusIcon status={value} />
          {!compact && <span>{STATUS_LABEL[value]}</span>}
        </button>
      }
    />
  );
}

export function PriorityPicker({ value, onChange, compact, disabled }: { value: TaskPriority; onChange: (p: TaskPriority) => void; compact?: boolean; disabled?: boolean }) {
  return (
    <Picker
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder="Set priority"
      options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))}
      trigger={
        <button type="button" className={cn(triggerCls, compact && "h-6 w-6 justify-center px-0")} aria-label={`Priority: ${PRIORITY_LABEL[value]}`}>
          <PriorityIcon priority={value} />
          {!compact && <span className={value === "NONE" ? "text-muted" : ""}>{PRIORITY_LABEL[value]}</span>}
        </button>
      }
    />
  );
}

export function AssigneePicker({
  value,
  members,
  onChange,
  compact,
  disabled,
}: {
  value: UserRef | null;
  members: MemberItem[];
  onChange: (id: string | null) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const eligible = members.filter((m) => m.role !== "VIEWER");
  return (
    <Picker
      value={value?.id ?? null}
      onChange={onChange}
      disabled={disabled}
      placeholder="Assign to"
      options={[
        { value: null, label: "Unassigned", icon: <UserRound className="size-4 text-faint" /> },
        ...eligible.map((m) => ({ value: m.user.id, label: m.user.displayName, search: m.user.username, icon: <Avatar user={m.user} size={16} /> })),
      ]}
      trigger={
        <button type="button" className={cn(triggerCls, compact && "h-6 w-6 justify-center px-0")} aria-label={value ? `Assigned to ${value.displayName}` : "Unassigned"}>
          {value ? <Avatar user={value} size={compact ? 18 : 16} /> : <UserRound className="size-4 text-faint" />}
          {!compact && <span className={cn("truncate", !value && "text-muted")}>{value?.displayName ?? "Unassigned"}</span>}
        </button>
      }
    />
  );
}

export function MilestonePicker({
  value,
  milestones,
  onChange,
  disabled,
}: {
  value: { id: string; title: string } | null;
  milestones: MilestoneSummary[];
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const open = milestones.filter((m) => m.status !== "DONE" && m.status !== "CANCELED");
  return (
    <Picker
      value={value?.id ?? null}
      onChange={onChange}
      disabled={disabled}
      placeholder="Set milestone"
      options={[
        { value: null, label: "No milestone", icon: <Flag className="size-3.5 text-faint" /> },
        ...open.map((m) => ({ value: m.id, label: m.title, icon: <Flag className="size-3.5 text-muted" /> })),
      ]}
      trigger={
        <button type="button" className={triggerCls}>
          <Flag className={cn("size-3.5", value ? "text-muted" : "text-faint")} />
          <span className={cn("truncate", !value && "text-muted")}>{value?.title ?? "No milestone"}</span>
        </button>
      }
    />
  );
}

/** A text button showing the date (or "No due date") that opens the native date picker. */
export function DueDateInput({ value, onChange, disabled }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const now = useNow();
  const due = dueState(value, now);
  const open = () => {
    const el = ref.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };
  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={open}
        className={cn(triggerCls, !value && "text-muted", due === "overdue" && "text-danger", due === "soon" && "text-warning")}
      >
        <CalendarDays className={cn("size-3.5", value ? "" : "text-faint")} />
        <span className="tnum">{value ? shortDate(value) : "No due date"}</span>
      </button>
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        aria-label="Due date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="pointer-events-none absolute left-0 top-full h-0 w-0 opacity-0"
      />
      {value && !disabled && (
        <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-faint hover:bg-surface-hover hover:text-fg" aria-label="Clear due date">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
