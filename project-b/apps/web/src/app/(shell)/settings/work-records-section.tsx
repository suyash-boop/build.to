"use client";

import type { SidebarProject, WorkRecordItem, WorkRecordView } from "@bldt/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Copy, Download, ExternalLink, FileSignature, MoreHorizontal, Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/choice";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input } from "@/components/ui/input";
import { Badge, Panel } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { errorMessage, http } from "@/lib/api.client";
import { cn, plural, shortDate } from "@/lib/utils";

const KEY = ["me", "work-records"] as const;

function summaryLine(s: WorkRecordItem["summary"]) {
  const parts = [
    s.pullRequestsMerged ? plural(s.pullRequestsMerged, "merged pull request") : null,
    s.tasksCompleted ? plural(s.tasksCompleted, "task") + " done" : null,
    s.reviews ? plural(s.reviews, "review") : null,
    s.releases ? plural(s.releases, "release") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No recorded work in this period";
}

export function recordUrl(id: string) {
  return `${window.location.origin}/projects/verify/${id}`;
}

async function downloadRecord(id: string) {
  const view = await http.get<WorkRecordView>(`/work-records/${id}`);
  const blob = new Blob([JSON.stringify(view.signed, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bldt-work-record-${id.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function WorkRecordsSection({
  projects,
  initial,
  githubLinked,
}: {
  projects: SidebarProject[];
  initial: { items: WorkRecordItem[]; enabled: boolean };
  githubLinked: boolean;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: KEY, queryFn: () => http.get<{ items: WorkRecordItem[]; enabled: boolean }>("/me/work-records"), initialData: initial });
  const [issuing, setIssuing] = useState(false);
  const [revoke, setRevoke] = useState<WorkRecordItem | null>(null);
  const items = data.items;

  const copy = async (id: string) => {
    await navigator.clipboard.writeText(recordUrl(id));
    toast.success("Link copied");
  };

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Work records</h2>
          <p className="mt-0.5 text-sm text-muted">
            Signed statements of your work on a project, for a CV, a client, or a hiring manager. They are built only from what bld.t observed: pull requests
            GitHub shows you merged, and tasks you completed here. Anyone can verify them, and any edit breaks the signature.
          </p>
        </div>
      </div>
      {!data.enabled ? (
        <Panel className="px-4 py-3 text-sm text-muted">Work records are not enabled on this server.</Panel>
      ) : (
        <>
          {items.length > 0 && (
            <Panel className="mb-3 divide-y divide-border overflow-hidden">
              {items.map((r) => (
                <div key={r.id} className={cn("flex items-center gap-3 px-4 py-3", r.revokedAt && "opacity-60")}>
                  <FileSignature className="size-4 shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm">
                      <span className="truncate">{r.project.name ?? "Private project"}</span>
                      {r.revokedAt && <Badge tone="danger">Revoked</Badge>}
                    </p>
                    <p className="truncate text-xs text-faint tnum">
                      {shortDate(r.period.from)} to {shortDate(r.period.to)} · {summaryLine(r.summary)}
                    </p>
                  </div>
                  {!r.revokedAt && (
                    <Button size="sm" variant="ghost" onClick={() => copy(r.id)} className="hidden sm:inline-flex">
                      <Copy className="size-3.5" /> Copy link
                    </Button>
                  )}
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label="Record actions">
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => window.open(`/verify/${r.id}`, "_blank", "noopener")}>
                        <ExternalLink className="size-3.5 text-faint" /> Open public page
                      </MenuItem>
                      <MenuItem onSelect={() => copy(r.id)}>
                        <Copy className="size-3.5 text-faint" /> Copy link
                      </MenuItem>
                      <MenuItem onSelect={() => downloadRecord(r.id).catch((err) => toast.error(errorMessage(err)))}>
                        <Download className="size-3.5 text-faint" /> Download signed JSON
                      </MenuItem>
                      {!r.revokedAt && (
                        <>
                          <MenuSeparator />
                          <MenuItem destructive onSelect={() => setRevoke(r)}>
                            <Undo2 className="size-3.5" /> Revoke
                          </MenuItem>
                        </>
                      )}
                    </MenuContent>
                  </Menu>
                </div>
              ))}
            </Panel>
          )}
          <Button onClick={() => setIssuing(true)} disabled={projects.length === 0}>
            <Plus className="size-3.5" /> Issue a record
          </Button>
          {projects.length === 0 && <p className="mt-2 text-xs text-faint">Join or start a project first.</p>}
        </>
      )}

      <Dialog open={issuing} onOpenChange={setIssuing}>
        {issuing && (
          <IssueDialog
            projects={projects}
            githubLinked={githubLinked}
            onDone={async (id) => {
              setIssuing(false);
              await qc.invalidateQueries({ queryKey: KEY });
              if (id) {
                await navigator.clipboard.writeText(recordUrl(id)).catch(() => {});
                toast.success("Record issued. Link copied.", { action: { label: "Open", onClick: () => window.open(`/verify/${id}`, "_blank", "noopener") } });
              }
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={revoke !== null}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revoke this record?"
        description="Anyone who checks it, by link or with the JSON, will see that you revoked it. This cannot be undone; you can issue a new record."
        confirmLabel="Revoke record"
        destructive
        onConfirm={async () => {
          try {
            await http.post(`/me/work-records/${revoke!.id}/revoke`, {});
            toast.success("Record revoked");
            await qc.invalidateQueries({ queryKey: KEY });
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </section>
  );
}

type Preset = "joined" | "90" | "365" | "custom";
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function IssueDialog({ projects, githubLinked, onDone }: { projects: SidebarProject[]; githubLinked: boolean; onDone: (id?: string) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [preset, setPreset] = useState<Preset>("joined");
  const today = isoDay(new Date());
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === projectId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setBusy(true);
    try {
      const period =
        preset === "joined" ? {} : preset === "custom" ? { from, to } : { from: isoDay(new Date(Date.now() - Number(preset) * 86_400_000)) };
      const res = await http.post<{ item: WorkRecordItem }>("/me/work-records", { owner: project.ownerUsername, slug: project.slug, ...period });
      onDone(res.item.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="Issue a work record" description="Signed now, from the evidence bld.t has. It does not change later, even if the project does." wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Project">
          {(id) => (
            <select
              id={id}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.ownerUsername}/{p.slug})
                </option>
              ))}
            </select>
          )}
        </Field>
        {project?.visibility === "PRIVATE" && (
          <p className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-muted">
            This project is private, so the record leaves out its name and every title, and states counts only.
          </p>
        )}
        <Field label="Period">
          {() => (
            <div className="space-y-2">
              <div>
                <Segmented
                  value={preset}
                  onChange={setPreset}
                  options={[
                    { value: "joined", label: "Since I joined" },
                    { value: "90", label: "Last 90 days" },
                    { value: "365", label: "Last year" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
              </div>
              {preset === "custom" && (
                <div className="flex items-center gap-2 text-sm">
                  <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" className="w-40" />
                  <span className="text-faint">to</span>
                  <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} aria-label="To" className="w-40" />
                </div>
              )}
            </div>
          )}
        </Field>
        {!githubLinked && (
          <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted">
            Your GitHub account is not linked, so this record will not count any pull requests or reviews. Link GitHub above first if you want them included.
          </p>
        )}
        <div className="flex items-start gap-2 text-xs text-muted">
          <BadgeCheck className="mt-px size-3.5 shrink-0 text-success" />
          <span>Pull requests count when GitHub shows your linked account authored them and they merged. Tasks count when they were assigned to you and completed.</span>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!project}>
            Sign and issue
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
