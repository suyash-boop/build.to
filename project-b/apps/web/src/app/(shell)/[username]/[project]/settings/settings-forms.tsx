"use client";

import type { ImportableRepository, ProjectDetail, SignalSettingsDto, TechCategory, UserRef, Visibility, WebhookEndpointItem } from "@bldt/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Copy, Eye, EyeOff, Globe, Link2, Lock, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { GithubMark } from "@/components/domain/logo";
import { SIGNAL_LABELS, SignalIcon } from "@/components/domain/signal";
import { Markdown } from "@/components/domain/markdown";
import { TechChip } from "@/components/domain/status";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { RadioCards, Segmented, Switch } from "@/components/ui/choice";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Avatar, Badge, Panel } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { ApiError, errorMessage, http } from "@/lib/api.client";
import { cn } from "@/lib/utils";
import { RepoPicker } from "../../../new/new-project-flow";
import { WebhooksSection } from "./webhooks-section";

export interface TechOption {
  slug: string;
  name: string;
  category: TechCategory;
  color: string | null;
}
export interface Delivery {
  id: string;
  event: string;
  action: string | null;
  repository: string | null;
  status: "RECEIVED" | "PROCESSED" | "IGNORED" | "FAILED";
  error: string | null;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
}
export interface AuditEntry {
  id: string;
  action: string;
  actor: UserRef | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function ProjectSettings({
  project: p,
  origin,
  viewerId,
  catalog,
  deliveries,
  audit,
  maintainers,
  githubConnected,
  signalSettings,
  webhooks,
}: {
  project: ProjectDetail;
  origin: string;
  viewerId: string;
  catalog: TechOption[];
  deliveries: Delivery[];
  audit: AuditEntry[];
  maintainers: UserRef[];
  githubConnected: boolean;
  signalSettings: SignalSettingsDto;
  webhooks: WebhookEndpointItem[];
}) {
  const perms = new Set(p.viewer.permissions);
  const api = `/projects/${p.owner.username}/${p.slug}`;
  return (
    <div className="space-y-10">
      <General project={p} api={api} />
      {perms.has("project.visibility") && <VisibilitySection project={p} api={api} />}
      <StackSection project={p} api={api} catalog={catalog} />
      <SignalsSection api={api} initial={signalSettings} />
      {perms.has("project.integrations") && (
        <Integrations project={p} api={api} deliveries={deliveries} githubConnected={githubConnected} />
      )}
      {perms.has("project.integrations") && <WebhooksSection api={api} initial={webhooks} />}
      {p.visibility === "PUBLIC" && <BadgeSection project={p} origin={origin} />}
      {perms.has("audit.view") && <AuditSection entries={audit} />}
      {perms.has("project.delete") && <DangerZone project={p} api={api} viewerId={viewerId} maintainers={maintainers} />}
    </div>
  );
}

function Section({ id, title, description, children }: { id?: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function useSave() {
  const router = useRouter();
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>, message: string, opts: { redirect?: string } = {}) => {
    await fn();
    toast.success(message);
    await qc.invalidateQueries({ queryKey: ["me", "projects"] });
    if (opts.redirect) router.replace(opts.redirect);
    router.refresh();
  };
}

/* ── General ──────────────────────────────────────────────── */

function General({ project: p, api }: { project: ProjectDetail; api: string }) {
  const save = useSave();
  const [name, setName] = useState(p.name);
  const [slug, setSlug] = useState(p.slug);
  const [tagline, setTagline] = useState(p.tagline ?? "");
  const [homepageUrl, setHomepageUrl] = useState(p.homepageUrl ?? "");
  const [description, setDescription] = useState(p.description ?? "");
  const [preview, setPreview] = useState(false);
  const [open, setOpen] = useState(p.openToContributors);
  const [roles, setRoles] = useState<string[]>(p.lookingFor);
  const [roleDraft, setRoleDraft] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const dirty =
    name !== p.name ||
    slug !== p.slug ||
    tagline !== (p.tagline ?? "") ||
    homepageUrl !== (p.homepageUrl ?? "") ||
    description !== (p.description ?? "") ||
    open !== p.openToContributors ||
    roles.join("\n") !== p.lookingFor.join("\n");

  const addRole = () => {
    const r = roleDraft.trim();
    if (r && !roles.includes(r) && roles.length < 8) setRoles([...roles, r]);
    setRoleDraft("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await save(
        () => http.patch<{ owner: string; slug: string }>(api, { name, slug, tagline, homepageUrl, description, openToContributors: open, lookingFor: roles }),
        "Project updated",
        { redirect: slug !== p.slug ? `/${p.owner.username}/${slug}/settings` : undefined },
      );
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) setErrors(err.fieldErrors());
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="General">
      <form onSubmit={submit}>
        <Panel className="space-y-5 p-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Name" error={errors.name}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />}</Field>
            <Field label="URL" error={errors.slug} hint={slug !== p.slug ? "Old links will stop working." : undefined}>
              {(id, d) => <Input id={id} aria-describedby={d} leading={`/${p.owner.username}/`} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "-"))} maxLength={64} />}
            </Field>
            <Field label="One-line description" optional className="md:col-span-2" error={errors.tagline}>
              {(id) => <Input id={id} value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={160} />}
            </Field>
            <Field label="Website" optional className="md:col-span-2" error={errors.homepageUrl}>
              {(id) => <Input id={id} type="url" value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} placeholder="https://" />}
            </Field>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="desc" className="text-sm font-medium">About</label>
              <Segmented size="sm" value={preview ? "preview" : "write"} onChange={(v) => setPreview(v === "preview")} options={[{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }]} />
            </div>
            {preview ? (
              <div className="min-h-40 rounded-md border border-border px-4 py-3">
                {description ? <Markdown>{description}</Markdown> : <p className="text-sm text-faint">Nothing to preview</p>}
              </div>
            ) : (
              <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={8} maxLength={20000} placeholder="Markdown. Shown on the overview instead of the README when set." />
            )}
            <p className="mt-1.5 text-xs text-faint">Leave empty to show the primary repository README.</p>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Open to contributors</p>
                <p className="text-xs text-muted">Shows the project in discovery as looking for help and lets people request to join. Public projects only.</p>
              </div>
              <Switch checked={open} onChange={setOpen} label="Open to contributors" disabled={p.visibility !== "PUBLIC"} />
            </div>
            {open && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-muted">Roles you are looking for</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {roles.map((r) => (
                    <span key={r} className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface-2 pl-2 pr-1 text-xs">
                      {r}
                      <button type="button" onClick={() => setRoles(roles.filter((x) => x !== r))} className="rounded p-0.5 text-faint hover:text-fg" aria-label={`Remove ${r}`}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {roles.length < 8 && (
                    <input
                      value={roleDraft}
                      onChange={(e) => setRoleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addRole();
                        }
                      }}
                      onBlur={addRole}
                      placeholder={roles.length ? "Add another" : "Frontend, Design, Docs"}
                      maxLength={40}
                      aria-label="Add a role"
                      className="h-6 min-w-32 flex-1 bg-transparent text-xs outline-none placeholder:text-faint"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </Panel>
        <div className="mt-3 flex justify-end">
          <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Save changes</Button>
        </div>
      </form>
    </Section>
  );
}

/* ── Visibility ───────────────────────────────────────────── */

function VisibilitySection({ project: p, api }: { project: ProjectDetail; api: string }) {
  const save = useSave();
  const [value, setValue] = useState<Visibility>(p.visibility);
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title="Visibility" description="Only the owner can change this. Every change is recorded in the audit log.">
      <RadioCards
        name="Visibility"
        value={value}
        onChange={setValue}
        options={[
          { value: "PRIVATE", title: "Private", description: "Members only. Counts, unnamed, on members' profiles.", icon: <Lock className="size-4" /> },
          { value: "UNLISTED", title: "Unlisted", description: "Anyone with the link. Not in discovery, search, or search engines.", icon: <Link2 className="size-4" /> },
          { value: "PUBLIC", title: "Public", description: "Listed in discovery and on members' profiles. Tasks stay members-only.", icon: <Globe className="size-4" /> },
        ]}
      />
      <div className="mt-3 flex justify-end">
        <Button variant="primary" disabled={value === p.visibility} onClick={() => setConfirm(true)}>Change visibility</Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Make ${p.name} ${value.toLowerCase()}?`}
        description={
          value === "PUBLIC"
            ? "The overview, README, releases, activity, and member list become visible to everyone and the project appears in discovery."
            : value === "UNLISTED"
              ? "Anyone with the link can see the overview, README, releases, and activity."
              : "Only members will be able to see the project. It disappears from discovery and public profiles."
        }
        confirmLabel="Change visibility"
        onConfirm={() => save(() => http.patch(api, { visibility: value }), "Visibility updated")}
      />
    </Section>
  );
}

/* ── Signals ────────────────────────────────────────────── */

type Threshold = { key: "stalledDays" | "reviewHours" | "wipLimit" | "atRiskBelow"; unit: string; min: number; max: number; percent?: boolean };

const SIGNAL_THRESHOLDS: Record<string, Threshold> = {
  "task.stalled": { key: "stalledDays", unit: "days", min: 1, max: 60 },
  "review.waiting": { key: "reviewHours", unit: "hours", min: 1, max: 336 },
  "wip.overload": { key: "wipLimit", unit: "tasks", min: 1, max: 20 },
  "milestone.at_risk": { key: "atRiskBelow", unit: "% on time", min: 10, max: 99, percent: true },
};

function SignalsSection({ api, initial }: { api: string; initial: SignalSettingsDto }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  const toggle = (type: string, on: boolean) =>
    setDraft((d) => ({ ...d, disabled: on ? d.disabled.filter((t) => t !== type) : [...d.disabled, type] }));

  const submit = async () => {
    setBusy(true);
    try {
      const next = await http.patch<SignalSettingsDto>(`${api}/signal-settings`, draft);
      setSaved(next);
      setDraft(next);
      toast.success("Signal settings saved. The project is being rescanned.");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="signals"
      title="Signals"
      description="bld.t watches tasks, reviews, deployments and the milestone forecast, and raises what needs attention. Warnings and criticals notify the people who can act on them."
    >
      <Panel className="divide-y divide-border">
        {Object.entries(SIGNAL_LABELS).map(([type, label]) => {
          const on = !draft.disabled.includes(type);
          const t = SIGNAL_THRESHOLDS[type];
          const raw = t ? draft[t.key] : 0;
          const shown = t?.percent ? Math.round(raw * 100) : raw;
          return (
            <div key={type} className="flex items-center gap-3 px-4 py-3">
              <SignalIcon signal={{ type, severity: "INFO" }} className={on ? "text-muted" : "text-faint"} />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", !on && "text-muted")}>{label.name}</p>
                <p className="text-xs text-faint">{label.hint}</p>
              </div>
              {t && (
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-faint">
                  <span className="sr-only">{label.name} threshold</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={t.min}
                    max={t.max}
                    disabled={!on}
                    value={Number.isFinite(shown) ? shown : ""}
                    onChange={(e) => {
                      const n = Math.min(t.max, Math.max(t.min, Math.round(Number(e.target.value) || t.min)));
                      setDraft((d) => ({ ...d, [t.key]: t.percent ? n / 100 : n }));
                    }}
                    className="h-7 w-16 text-right tnum"
                  />
                  <span className="w-16">{t.unit}</span>
                </label>
              )}
              <Switch checked={on} onChange={(v) => toggle(type, v)} label={`${on ? "Disable" : "Enable"} ${label.name}`} />
            </div>
          );
        })}
      </Panel>
      <div className="mt-3 flex justify-end gap-2">
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(saved)}>
            Reset
          </Button>
        )}
        <Button variant="primary" disabled={!dirty} loading={busy} onClick={submit}>
          Save signals
        </Button>
      </div>
    </Section>
  );
}

/* ── Stack ────────────────────────────────────────────────── */

function StackSection({ project: p, api, catalog }: { project: ProjectDetail; api: string; catalog: TechOption[] }) {
  const save = useSave();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const have = new Set(p.allTechnologies.map((t) => t.slug));
  const options = useMemo(
    () => catalog.filter((t) => !have.has(t.slug) && t.name.toLowerCase().includes(q.toLowerCase())).slice(0, 30),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, q, p.allTechnologies],
  );
  const patch = (body: { add?: string[]; hide?: string[]; unhide?: string[] }, msg: string) =>
    save(() => http.patch(`${api}/technologies`, body), msg).catch((e) => toast.error(errorMessage(e)));

  return (
    <Section title="Stack" description="Detected from repository languages and manifest files. Hide anything that is not representative, or add what detection missed.">
      <Panel className="divide-y divide-border">
        {p.allTechnologies.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nothing detected yet. Connect a repository or add technologies manually.</p>}
        {p.allTechnologies.map((t) => (
          <div key={t.slug} className={cn("flex items-center gap-3 px-4 py-2", t.hidden && "opacity-55")}>
            <TechChip tech={t} />
            <span className="min-w-0 flex-1 truncate text-xs text-faint">
              {t.source === "DETECTED" ? <>Detected in <span className="font-mono">{t.evidence}</span></> : t.evidence ? <>Added manually, confirmed in <span className="font-mono">{t.evidence}</span></> : "Added manually"}
              {t.share > 0 && <> · {(t.share * 100).toFixed(1)}%</>}
            </span>
            <Button size="xs" variant="ghost" onClick={() => patch(t.hidden ? { unhide: [t.slug] } : { hide: [t.slug] }, t.hidden ? `${t.name} shown` : `${t.name} hidden`)}>
              {t.hidden ? <><Eye className="size-3.5" /> Show</> : <><EyeOff className="size-3.5" /> Hide</>}
            </Button>
          </div>
        ))}
        <div className="px-4 py-2">
          <Popover open={adding} onOpenChange={setAdding}>
            <PopoverTrigger asChild>
              <Button size="xs" variant="ghost"><Plus className="size-3.5" /> Add technology</Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search technologies" className="h-9 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-faint" />
              <div className="max-h-64 overflow-y-auto p-1">
                {options.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted">No matches</p>}
                {options.map((t) => (
                  <button
                    key={t.slug}
                    onClick={() => {
                      setAdding(false);
                      setQ("");
                      patch({ add: [t.slug] }, `${t.name} added`);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-surface-hover"
                  >
                    <span className="size-2 rounded-full" style={{ background: t.color ?? "var(--border-strong)" }} />
                    <span className="flex-1">{t.name}</span>
                    <span className="text-2xs text-faint">{t.category.toLowerCase()}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </Panel>
    </Section>
  );
}

/* ── Integrations ─────────────────────────────────────────── */

function Integrations({ project: p, api, deliveries, githubConnected }: { project: ProjectDetail; api: string; deliveries: Delivery[]; githubConnected: boolean }) {
  const save = useSave();
  const [connecting, setConnecting] = useState(false);
  const [picked, setPicked] = useState<ImportableRepository[]>([]);
  const [busy, setBusy] = useState(false);
  const [disconnect, setDisconnect] = useState<ProjectDetail["repositories"][number] | null>(null);

  const connect = async () => {
    setBusy(true);
    try {
      await save(() => http.post(`${api}/repositories`, { repositoryGithubIds: picked.map((r) => r.githubId) }), "Repositories connected. Syncing now.");
      setConnecting(false);
      setPicked([]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="integrations" title="Repositories" description="Synced through the bld.t GitHub App. Webhooks keep things current; a full sync also runs every few hours.">
      <Panel className="divide-y divide-border">
        {p.repositories.length === 0 && <p className="px-4 py-5 text-sm text-muted">No repositories connected.</p>}
        {p.repositories.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <GithubMark className="size-4 text-faint" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm">
                <a href={r.htmlUrl} target="_blank" rel="noopener noreferrer" className="truncate font-medium hover:underline">{r.fullName}</a>
                {r.isPrimary && <Badge>Primary</Badge>}
                {r.isPrivate && <Lock className="size-3 text-faint" aria-label="Private" />}
              </p>
              {r.syncStatus === "FAILED" ? (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-danger"><AlertCircle className="size-3" /> {r.syncError}</p>
              ) : (
                <p className="mt-0.5 text-xs text-faint">
                  {r.syncStatus === "SYNCING" ? "Syncing now" : r.syncStatus === "QUEUED" ? "Queued" : r.lastSyncedAt ? <>Last synced <RelativeTime iso={r.lastSyncedAt} /></> : "Not synced yet"}
                </p>
              )}
            </div>
            <Button size="xs" onClick={() => save(() => http.post(`${api}/repositories/${r.id}/sync`), "Sync queued").catch((e) => toast.error(errorMessage(e)))}>
              <RefreshCw className="size-3.5" /> Sync now
            </Button>
            <Button size="xs" variant="danger-ghost" onClick={() => setDisconnect(r)}>Disconnect</Button>
          </div>
        ))}
        <div className="px-4 py-2">
          <Button size="xs" variant="ghost" onClick={() => setConnecting(true)}><Plus className="size-3.5" /> Connect repository</Button>
        </div>
      </Panel>

      {deliveries.length > 0 && (
        <details className="group mt-4">
          <summary className="cursor-pointer select-none text-xs text-muted hover:text-fg">
            Recent webhook deliveries ({deliveries.length}) {deliveries.some((d) => d.status === "FAILED") && <span className="text-danger">· some failed</span>}
          </summary>
          <Panel className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-faint">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Repository</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 text-right font-medium">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-1.5 font-mono">{d.event}{d.action ? `.${d.action}` : ""}</td>
                    <td className="px-3 py-1.5 text-muted">{d.repository}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn(d.status === "FAILED" ? "text-danger" : d.status === "PROCESSED" ? "text-success" : "text-faint")} title={d.error ?? undefined}>
                        {d.status.toLowerCase()}
                        {d.attempts > 1 && ` after ${d.attempts} attempts`}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-faint"><RelativeTime iso={d.receivedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </details>
      )}

      <Dialog open={connecting} onOpenChange={(o) => { setConnecting(o); if (!o) setPicked([]); }}>
        {connecting && (
          <DialogContent title="Connect repositories" description="Pick repositories the bld.t GitHub App can access." wide>
            <RepoPicker githubConnected={githubConnected} selected={picked} onChange={setPicked} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConnecting(false)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={picked.length === 0} onClick={connect}>
                Connect {picked.length > 0 ? picked.length : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <ConfirmDialog
        open={disconnect !== null}
        onOpenChange={(o) => !o && setDisconnect(null)}
        title={`Disconnect ${disconnect?.fullName}?`}
        description="New pull requests and releases stop syncing. Past activity and linked pull requests stay in the project history."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => save(() => http.del(`${api}/repositories/${disconnect!.id}`), "Repository disconnected")}
      />
    </Section>
  );
}

/* ── Badge ────────────────────────────────────────────────── */

function BadgeSection({ project: p, origin }: { project: ProjectDetail; origin: string }) {
  const [copied, setCopied] = useState(false);
  const img = `${origin}/projects/api/badge/${p.owner.username}/${p.slug}.svg`;
  const md = `[![bld.t](${img})](${origin}/${p.owner.username}/${p.slug})`;
  return (
    <Section title="README badge" description="Shows the project's current stage and links back here. Updates automatically.">
      <Panel className="flex flex-wrap items-center gap-3 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/projects/api/badge/${p.owner.username}/${p.slug}.svg`} alt={`build.to stage badge for ${p.name}`} height={20} />
        <code className="min-w-0 flex-1 truncate rounded-sm bg-bg-subtle px-2 py-1 font-mono text-xs text-muted">{md}</code>
        <Button
          size="xs"
          onClick={async () => {
            await navigator.clipboard.writeText(md);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy markdown</>}
        </Button>
      </Panel>
    </Section>
  );
}

/* ── Audit ────────────────────────────────────────────────── */

const AUDIT_COPY: Record<string, (m: Record<string, unknown>) => string> = {
  "project.create": () => "created the project",
  "project.visibility": (m) => `changed visibility from ${String(m.from).toLowerCase()} to ${String(m.to).toLowerCase()}`,
  "project.ship": () => "recorded a ship",
  "project.transfer": () => "transferred ownership",
  "project.delete": () => "deleted the project",
  "member.invite": (m) => `sent an invitation as ${String(m.role).toLowerCase()}`,
  "member.role": (m) => `changed a member's role from ${String(m.from).toLowerCase()} to ${String(m.to).toLowerCase()}`,
  "member.remove": () => "removed a member",
  "member.leave": () => "left the project",
  "integration.connect": (m) => `connected ${Array.isArray(m.repositories) ? m.repositories.length : 1} repositories`,
  "integration.disconnect": () => "disconnected a repository",
};

function AuditSection({ entries }: { entries: AuditEntry[] }) {
  return (
    <Section title="Audit log" description="Administrative changes, most recent first.">
      {entries.length === 0 ? (
        <Panel className="px-4 py-5 text-sm text-muted">No administrative changes yet.</Panel>
      ) : (
        <Panel className="divide-y divide-border">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-2.5 px-4 py-2 text-sm">
              <Avatar user={e.actor} size={18} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{e.actor?.displayName ?? "System"}</span>{" "}
                <span className="text-muted">{AUDIT_COPY[e.action]?.(e.metadata) ?? e.action}</span>
              </span>
              <RelativeTime iso={e.createdAt} className="shrink-0 text-xs text-faint" />
            </div>
          ))}
        </Panel>
      )}
    </Section>
  );
}

/* ── Danger zone ──────────────────────────────────────────── */

function DangerZone({ project: p, api, viewerId, maintainers }: { project: ProjectDetail; api: string; viewerId: string; maintainers: UserRef[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [del, setDel] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [target, setTarget] = useState(maintainers.find((m) => m.id !== viewerId)?.id ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <Section title="Danger zone">
      <Panel className="divide-y divide-border border-danger/30">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Transfer ownership</p>
            <p className="text-xs text-muted">Hand the project to a maintainer. You stay on as a maintainer.</p>
          </div>
          <Button size="sm" variant="secondary" disabled={maintainers.length === 0} onClick={() => setTransfer(true)} title={maintainers.length === 0 ? "Promote someone to maintainer first" : undefined}>
            Transfer
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Delete project</p>
            <p className="text-xs text-muted">Removes the project for every member. Repositories on GitHub are not touched.</p>
          </div>
          <Button size="sm" variant="danger" onClick={() => setDel(true)}><Trash2 className="size-3.5" /> Delete</Button>
        </div>
      </Panel>

      <Dialog open={transfer} onOpenChange={setTransfer}>
        {transfer && (
          <DialogContent title="Transfer ownership" description="The new owner can change visibility, transfer again, or delete the project.">
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm" aria-label="New owner">
              {maintainers.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName} (@{m.username})</option>
              ))}
            </select>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setTransfer(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={!target}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await http.post<{ owner: string; slug: string }>(`${api}/transfer`, { userId: target });
                    toast.success("Ownership transferred");
                    await qc.invalidateQueries();
                    router.replace(`/${res.owner}/${res.slug}`);
                    router.refresh();
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Transfer ownership
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={`Delete ${p.name}?`}
        description="Tasks, milestones, discussion, and activity are deleted for everyone. This cannot be undone."
        confirmLabel="Delete project"
        destructive
        typeToConfirm={p.slug}
        onConfirm={async () => {
          await http.del(api, { confirm: p.slug });
          toast.success(`${p.name} deleted`);
          await qc.invalidateQueries();
          router.replace("/home");
          router.refresh();
        }}
      />
    </Section>
  );
}
