"use client";

import type { MilestoneStatus, MilestoneSummary } from "@bldt/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flag, MoreHorizontal, Pencil, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { ConfirmDialog } from "@/components/ui/confirm";
import { errorMessage, http } from "@/lib/api.client";
import { useNow } from "@/lib/use-now";
import { cn, dueState, shortDate } from "@/lib/utils";

export function MilestoneList({ owner, slug, initial, canManage }: { owner: string; slug: string; initial: MilestoneSummary[]; canManage: boolean }) {
  const base = `/projects/${owner}/${slug}`;
  const qc = useQueryClient();
  const key = ["milestones", owner, slug];
  const { data: items = initial } = useQuery({
    queryKey: key,
    queryFn: () => http.get<{ items: MilestoneSummary[] }>(`${base}/milestones`).then((r) => r.items),
    initialData: initial,
  });
  const [editing, setEditing] = useState<MilestoneSummary | "new" | null>(null);
  const [deleting, setDeleting] = useState<MilestoneSummary | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const setStatus = async (m: MilestoneSummary, status: MilestoneStatus) => {
    try {
      await http.patch(`${base}/milestones/${m.id}`, { status });
      toast.success(status === "DONE" ? `${m.title} completed` : status === "ACTIVE" ? `${m.title} is now the current milestone` : "Updated");
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const open = items.filter((m) => m.status === "ACTIVE" || m.status === "PLANNED");
  const closed = items.filter((m) => m.status === "DONE" || m.status === "CANCELED");

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Milestones</h2>
          <p className="text-sm text-muted">One milestone is current at a time. It shows on the project overview.</p>
        </div>
        {canManage && (
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" /> New milestone
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Flag className="size-5" />} title="No milestones yet" action={canManage ? <Button size="sm" onClick={() => setEditing("new")}>Create a milestone</Button> : undefined}>
          Group tasks into a goal with a date, like a beta or a launch.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {open.length > 0 && <Group items={open} owner={owner} slug={slug} canManage={canManage} onEdit={setEditing} onDelete={setDeleting} onStatus={setStatus} />}
          {closed.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Completed</h3>
              <Group items={closed} owner={owner} slug={slug} canManage={canManage} onEdit={setEditing} onDelete={setDeleting} onStatus={setStatus} />
            </div>
          )}
        </div>
      )}

      {editing && <MilestoneDialog base={base} milestone={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.title ?? "milestone"}?`}
        description="Tasks in it stay on the board without a milestone."
        confirmLabel="Delete milestone"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await http.del(`${base}/milestones/${deleting.id}`);
          toast.success("Milestone deleted");
          refresh();
        }}
      />
    </div>
  );
}

function Group({
  items,
  owner,
  slug,
  canManage,
  onEdit,
  onDelete,
  onStatus,
}: {
  items: MilestoneSummary[];
  owner: string;
  slug: string;
  canManage: boolean;
  onEdit: (m: MilestoneSummary) => void;
  onDelete: (m: MilestoneSummary) => void;
  onStatus: (m: MilestoneSummary, s: MilestoneStatus) => void;
}) {
  const now = useNow();
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {items.map((m) => {
        const pct = m.taskCounts.total ? Math.round((m.taskCounts.done / m.taskCounts.total) * 100) : 0;
        const due = m.status === "DONE" || m.status === "CANCELED" ? null : dueState(m.dueOn, now);
        return (
          <li key={m.id} className="px-4 py-3.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/${owner}/${slug}/tasks?milestone=${m.id}`} className="text-sm font-medium hover:underline">
                    {m.title}
                  </Link>
                  {m.status === "ACTIVE" && <Badge tone="accent">Current</Badge>}
                  {m.status === "CANCELED" && <Badge>Canceled</Badge>}
                </div>
                {m.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{m.description}</p>}
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="tnum">
                  {m.taskCounts.done} of {m.taskCounts.total} done
                </p>
                {m.status === "DONE" && m.completedAt ? (
                  <p className="text-faint">Completed {shortDate(m.completedAt)}</p>
                ) : m.dueOn ? (
                  <p className={cn("tnum", due === "overdue" ? "text-danger" : due === "soon" ? "text-warning" : "text-faint")}>
                    {due === "overdue" ? "Overdue since" : "Due"} {shortDate(m.dueOn)}
                  </p>
                ) : (
                  <p className="text-faint">No date</p>
                )}
              </div>
              {canManage && (
                <Menu>
                  <MenuTrigger className="-mr-1 rounded-md p-1 text-faint hover:bg-surface-hover hover:text-fg" aria-label={`Actions for ${m.title}`}>
                    <MoreHorizontal className="size-4" />
                  </MenuTrigger>
                  <MenuContent>
                    {m.status === "PLANNED" && (
                      <MenuItem onSelect={() => onStatus(m, "ACTIVE")}>
                        <Play className="size-4 text-muted" /> Make current
                      </MenuItem>
                    )}
                    {(m.status === "PLANNED" || m.status === "ACTIVE") && (
                      <MenuItem onSelect={() => onStatus(m, "DONE")}>
                        <Check className="size-4 text-muted" /> Mark complete
                      </MenuItem>
                    )}
                    {(m.status === "DONE" || m.status === "CANCELED") && (
                      <MenuItem onSelect={() => onStatus(m, "PLANNED")}>
                        <Play className="size-4 text-muted" /> Reopen
                      </MenuItem>
                    )}
                    <MenuItem onSelect={() => onEdit(m)}>
                      <Pencil className="size-4 text-muted" /> Edit
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem destructive onSelect={() => onDelete(m)}>
                      <Trash2 className="size-4" /> Delete
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-sm bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.title} progress`}>
              <div className={cn("h-full", m.status === "CANCELED" ? "bg-faint" : "bg-st-shipped")} style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MilestoneDialog({ base, milestone, onClose, onSaved }: { base: string; milestone: MilestoneSummary | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(milestone?.title ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [dueOn, setDueOn] = useState(milestone?.dueOn ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { title, description, dueOn: dueOn || null };
      if (milestone) await http.patch(`${base}/milestones/${milestone.id}`, body);
      else await http.post(`${base}/milestones`, body);
      toast.success(milestone ? "Milestone updated" : "Milestone created");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={milestone ? "Edit milestone" : "New milestone"}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="v0.4 public beta" required maxLength={120} autoFocus />}</Field>
          <Field label="Target date" optional>{(id) => <Input id={id} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}</Field>
          <Field label="Description" optional>{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={4000} placeholder="What done looks like" />}</Field>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>{milestone ? "Save" : "Create milestone"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
