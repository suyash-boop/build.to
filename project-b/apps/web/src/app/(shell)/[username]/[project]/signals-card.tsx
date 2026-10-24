"use client";

import type { SignalItem } from "@bldt/contracts";
import { BellOff, ChevronDown, ExternalLink, MoreHorizontal, Settings2 } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SignalIcon, signalDetail, signalHref } from "@/components/domain/signal";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlay";
import { errorMessage, http } from "@/lib/api.client";
import { duration, ease } from "@/lib/motion";
import { cn, plural, shortDate } from "@/lib/utils";

const SNOOZE = [
  { days: 1, label: "Until tomorrow" },
  { days: 3, label: "For 3 days" },
  { days: 7, label: "For a week" },
  { days: 30, label: "For 30 days" },
] as const;

/**
 * What needs attention in this project, worked out by the signals engine from task movement,
 * reviews, deployments and the milestone forecast. Snoozing hides an alert for everyone on the team.
 */
export function SignalsCard({
  owner,
  slug,
  initialOpen,
  initialSnoozed,
  canSnooze,
  canConfigure,
}: {
  owner: string;
  slug: string;
  initialOpen: SignalItem[];
  initialSnoozed: SignalItem[];
  canSnooze: boolean;
  canConfigure: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [snoozed, setSnoozed] = useState(initialSnoozed);
  const [showSnoozed, setShowSnoozed] = useState(false);
  // Live updates re-render the page with fresh signals; adopt them.
  useEffect(() => {
    setOpen(initialOpen);
    setSnoozed(initialSnoozed);
  }, [initialOpen, initialSnoozed]);

  const snooze = async (s: SignalItem, days: 0 | 1 | 3 | 7 | 30) => {
    const prev = { open, snoozed };
    // Optimistic: the row moves immediately, and moves back if the server disagrees.
    if (days === 0) {
      setSnoozed((xs) => xs.filter((x) => x.id !== s.id));
      setOpen((xs) => [...xs, { ...s, snoozedUntil: null }]);
    } else {
      setOpen((xs) => xs.filter((x) => x.id !== s.id));
      setSnoozed((xs) => [{ ...s, snoozedUntil: new Date(Date.now() + days * 86_400_000).toISOString() }, ...xs.filter((x) => x.id !== s.id)]);
    }
    try {
      await http.post(`/projects/${owner}/${slug}/signals/${s.id}/snooze`, { days });
    } catch (err) {
      setOpen(prev.open);
      setSnoozed(prev.snoozed);
      toast.error(errorMessage(err));
    }
  };

  if (open.length === 0 && snoozed.length === 0) return null;
  const critical = open.filter((s) => s.severity === "CRITICAL").length;

  return (
    <section aria-labelledby="signals-heading" className="rounded-lg border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 id="signals-heading" className="text-sm font-medium">
          Needs attention
        </h2>
        <span className="text-xs text-faint tnum">
          {open.length === 0 ? "All clear" : plural(open.length, "item")}
          {critical > 0 && <span className="text-danger"> · {critical} critical</span>}
        </span>
        {canConfigure && (
          <Link
            href={`/${owner}/${slug}/settings#signals`}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-faint transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Settings2 className="size-3" /> Thresholds
          </Link>
        )}
      </header>

      <ul className="divide-y divide-border">
        <AnimatePresence initial={false}>
          {open.map((s) => (
            <SignalRow key={s.id} signal={s} onSnooze={canSnooze ? (d) => snooze(s, d) : undefined} />
          ))}
        </AnimatePresence>
      </ul>

      {snoozed.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setShowSnoozed((v) => !v)}
            aria-expanded={showSnoozed}
            className="flex w-full items-center gap-1.5 px-4 py-2 text-xs text-faint transition-colors hover:text-fg"
          >
            <ChevronDown className={cn("size-3 transition-transform duration-150", !showSnoozed && "-rotate-90")} />
            {plural(snoozed.length, "snoozed item")}
          </button>
          {showSnoozed && (
            <ul className="divide-y divide-border border-t border-border">
              {snoozed.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm text-muted">
                  <SignalIcon signal={s} className="text-faint" />
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="shrink-0 text-2xs text-faint tnum">until {shortDate(s.snoozedUntil!)}</span>
                  {canSnooze && (
                    <Button size="xs" variant="ghost" onClick={() => snooze(s, 0)}>
                      Unsnooze
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function SignalRow({ signal: s, onSnooze }: { signal: SignalItem; onSnooze?: (days: 1 | 3 | 7 | 30) => void }) {
  const { href, external } = signalHref(s);
  const detail = signalDetail(s);
  const title = (
    <>
      <span className="truncate">{s.title}</span>
      {external && <ExternalLink className="size-3 shrink-0 text-faint" />}
    </>
  );
  return (
    <m.li
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto", transition: { duration: duration.base, ease: ease.out } }}
      exit={{ opacity: 0, height: 0, transition: { duration: duration.fast, ease: ease.in } }}
      className="overflow-hidden"
    >
      <div className="group flex items-start gap-3 px-4 py-2.5">
        <SignalIcon signal={s} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          {external ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm hover:underline">
              {title}
            </a>
          ) : (
            <Link href={href} className="flex items-center gap-1 text-sm hover:underline">
              {title}
            </Link>
          )}
          <p className="mt-0.5 truncate text-xs text-faint">
            {detail}
            {detail && " · "}
            since <RelativeTime iso={s.firstSeenAt} />
          </p>
        </div>
        {onSnooze && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Snooze: ${s.title}`} className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Snooze for the team</MenuLabel>
              {SNOOZE.map((o) => (
                <MenuItem key={o.days} onSelect={() => onSnooze(o.days)}>
                  <BellOff className="size-3.5 text-faint" /> {o.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}
      </div>
    </m.li>
  );
}
