"use client";

import { Dialog as D, DropdownMenu as M, Popover as P, Tooltip as T } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── Dialog ───────────────────────────────────────────────── */

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="animate-overlay fixed inset-0 z-50 bg-black/40" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] -translate-x-1/2 rounded-lg border border-border bg-surface shadow-pop",
          "animate-pop max-h-[76vh] overflow-y-auto focus:outline-none",
          wide ? "max-w-2xl" : "max-w-md",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close className="-mr-1 rounded-md p-1 text-faint hover:bg-surface-hover hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="-mx-5 -mb-4 mt-5 flex justify-end gap-2 border-t border-border bg-bg-subtle px-5 py-3">{children}</div>;
}

/* ── Dropdown menu ────────────────────────────────────────── */

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, align = "end", ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={4}
        className={cn(
          "z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-pop animate-pop origin-(--radix-dropdown-menu-content-transform-origin)",
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, destructive, ...props }: ComponentProps<typeof M.Item> & { destructive?: boolean }) {
  return (
    <M.Item
      className={cn(
        "transition-ui flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-none",
        "data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50",
        destructive ? "text-danger" : "text-fg",
        className,
      )}
      {...props}
    />
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-faint">{children}</M.Label>;
}

export const MenuSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-border" />;

/* ── Popover ──────────────────────────────────────────────── */

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({ className, align = "start", ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={4}
        className={cn(
          "animate-pop z-50 origin-(--radix-popover-content-transform-origin) rounded-lg border border-border bg-surface shadow-pop focus:outline-none",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

/* ── Tooltip ──────────────────────────────────────────────── */

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg shadow-pop data-[state=delayed-open]:animate-[fade-in_140ms_var(--ease-out)] data-[state=instant-open]:animate-[fade-in_80ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_80ms_var(--ease-in)_forwards]"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
