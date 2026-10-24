"use client";

import { STAGE_LABEL, type ChangelogDto, type ProjectDetail, type ProjectStage } from "@bldt/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ListChecks, Rocket, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { StageGlyph } from "@/components/domain/status";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlay";
import { ApiError, errorMessage, http } from "@/lib/api.client";

export function ProjectActions({ project: p, signedIn, aiEnabled }: { project: ProjectDetail; signedIn: boolean; aiEnabled: boolean }) {
  const pathname = usePathname();
  const perms = new Set(p.viewer.permissions);
  const api = `/projects/${p.owner.username}/${p.slug}`;

  if (!p.viewer.role) {
    if (p.viewer.pendingInvitationId) return <AcceptInvite id={p.viewer.pendingInvitationId} />;
    if (!p.openToContributors || p.visibility !== "PUBLIC") return null;
    if (!signedIn) {
      return (
        <Button asChild size="sm" variant="primary">
          <Link href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in to join</Link>
        </Button>
      );
    }
    return p.viewer.pendingJoinRequest ? <PendingRequest api={api} /> : <JoinDialog api={api} lookingFor={p.lookingFor} />;
  }

  return (
    <>
      {perms.has("project.update") && <StageMenu project={p} api={api} />}
      {perms.has("project.ship") && <ShipDialog project={p} api={api} aiEnabled={aiEnabled} />}
    </>
  );
}

function useRefresh() {
  const router = useRouter();
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries();
    router.refresh();
  };
}

function ShipDialog({ project: p, api, aiEnabled }: { project: ProjectDetail; api: string; aiEnabled: boolean }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [url, setUrl] = useState(p.homepageUrl ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const first = !p.shippedAt;

  // Deterministic notes from what actually merged since the last release; no model involved.
  const fill = async () => {
    setFilling(true);
    try {
      const c = await http.get<ChangelogDto>(`${api}/changelog`);
      if (c.stats.pullRequests === 0 && c.stats.tasks === 0) {
        setDraftNote("Nothing has merged or been completed since the last release.");
        return;
      }
      setNotes(c.markdown);
      setDraftNote(
        `Filled from ${c.stats.pullRequests} merged pull ${c.stats.pullRequests === 1 ? "request" : "requests"}` +
          (c.stats.tasks ? ` and ${c.stats.tasks} completed ${c.stats.tasks === 1 ? "task" : "tasks"}` : "") +
          (c.truncated ? ". Only the most recent are listed." : "."),
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setFilling(false);
    }
  };

  const draft = async () => {
    setDrafting(true);
    try {
      const d = await http.post<{ title: string; notes: string; basedOn: { pullRequests: number; tasks: number } }>(`${api}/releases/draft`);
      if (!title.trim()) setTitle(d.title.slice(0, 120));
      setNotes(d.notes);
      setDraftNote(`Drafted from ${d.basedOn.pullRequests} merged pull requests and ${d.basedOn.tasks} completed tasks. Review before shipping.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await http.post(`${api}/ship`, { title, version: version || undefined, notes: notes || undefined, url: url || undefined });
      toast.success(first ? `${p.name} is shipped` : "Release recorded");
      setOpen(false);
      setTitle("");
      setVersion("");
      setNotes("");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) setErrors(err.fieldErrors());
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        <Rocket className="size-3.5" /> {first ? "Ship" : "Record release"}
      </Button>
      <DialogContent
        title={first ? `Ship ${p.name}` : "Record a release"}
        description={
          first
            ? "Marks the launch. The date, notes, and link go on the project timeline and on every member's profile."
            : "Adds a release to the timeline. GitHub releases on connected repositories are recorded automatically."
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="What shipped" error={errors.title}>
            {(id, d) => <Input id={id} aria-describedby={d} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={first ? "Public beta" : "Webhooks and retries"} required maxLength={120} autoFocus />}
          </Field>
          <Field label="Version" optional>
            {(id) => <Input id={id} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.0.0" className="font-mono" maxLength={40} />}
          </Field>
          <Field label="Link" optional error={errors.url} hint="Where people can see or use it.">
            {(id, d) => <Input id={id} aria-describedby={d} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />}
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <p className="text-xs text-muted" aria-live="polite">{draftNote ?? "Fill the notes from pull requests merged and tasks completed since the last release."}</p>
            <span className="flex shrink-0 gap-1.5">
              <Button size="xs" loading={filling} disabled={drafting} onClick={fill}>
                <ListChecks className="size-3" /> Fill from merged work
              </Button>
              {aiEnabled && (
                <Button size="xs" loading={drafting} disabled={filling} onClick={draft}>
                  <Sparkles className="size-3" /> Draft
                </Button>
              )}
            </span>
          </div>
          <Field label="Notes" optional hint="Markdown supported.">
            {(id, d) => <Textarea id={id} aria-describedby={d} value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="What changed, who it is for, what is next." />}
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
              {first ? "Ship it" : "Record release"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STAGE_HELP: Partial<Record<ProjectStage, string>> = {
  IDEA: "Not started yet",
  BUILDING: "Active development",
  MAINTAINED: "Shipped and kept up",
  PAUSED: "On hold, may resume",
  SUNSET: "Wound down for good",
};

function StageMenu({ project: p, api }: { project: ProjectDetail; api: string }) {
  const refresh = useRefresh();
  const [retro, setRetro] = useState<ProjectStage | null>(null);
  const [text, setText] = useState(p.retrospective ?? "");
  const [busy, setBusy] = useState(false);

  // SHIPPED is reached through Ship so the launch is always recorded.
  const options: ProjectStage[] = (["IDEA", "BUILDING", "MAINTAINED", "PAUSED", "SUNSET"] as const).filter(
    (s) => s !== p.stage && (s !== "MAINTAINED" || p.shippedAt) && (s !== "IDEA" || !p.shippedAt),
  );

  const change = async (stage: ProjectStage, retrospective?: string) => {
    setBusy(true);
    try {
      await http.post(`${api}/stage`, { stage, retrospective });
      toast.success(`Moved to ${STAGE_LABEL[stage]}`);
      setRetro(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm">
            <StageGlyph stage={p.stage} /> {STAGE_LABEL[p.stage]} <ChevronDown className="size-3.5 text-faint" />
          </Button>
        </MenuTrigger>
        <MenuContent className="w-60">
          <MenuLabel>Move project to</MenuLabel>
          {options.map((s) => (
            <MenuItem key={s} onSelect={() => (s === "PAUSED" || s === "SUNSET" ? setRetro(s) : change(s))}>
              <StageGlyph stage={s} />
              <span className="flex-1">{STAGE_LABEL[s]}</span>
              <span className="text-xs text-faint">{STAGE_HELP[s]}</span>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <Dialog open={retro !== null} onOpenChange={(o) => !o && setRetro(null)}>
        {retro && (
          <DialogContent
            title={retro === "SUNSET" ? `Sunset ${p.name}` : `Pause ${p.name}`}
            description="A short note keeps the history honest: what you learned, why it stopped, what someone picking it up should know. Shown on the project page."
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Optional" maxLength={4000} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRetro(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => change(retro, text || undefined)}>
                Move to {STAGE_LABEL[retro]}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function JoinDialog({ api, lookingFor }: { api: string; lookingFor: string[] }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState(lookingFor[0] ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await http.post(`${api}/requests`, { message, roleWanted: role || undefined });
      toast.success("Request sent. The maintainers will be notified.");
      setOpen(false);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Request to join
      </Button>
      <DialogContent title="Request to join" description="Maintainers see your profile and this message. Be specific about what you want to work on.">
        <form onSubmit={submit} className="space-y-4">
          {lookingFor.length > 0 && (
            <Field label="Role">
              {(id) => (
                <select
                  id={id}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {lookingFor.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                  <option value="">Something else</option>
                </select>
              )}
            </Field>
          )}
          <Field label="Message" hint={`${message.trim().length < 10 ? `At least 10 characters. ` : ""}${message.length}/1000`}>
            {(id, d) => <Textarea id={id} aria-describedby={d} value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={1000} placeholder="I have shipped two rate limiters in Go and would like to take the Redis backend." autoFocus />}
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={message.trim().length < 10}>Send request</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PendingRequest({ api }: { api: string }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex items-center gap-2 text-sm text-muted">
      Request pending
      <Button
        size="xs"
        variant="ghost"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await http.del(`${api}/requests/mine`).catch((e) => toast.error(errorMessage(e)));
          setBusy(false);
          await refresh();
        }}
      >
        Withdraw
      </Button>
    </span>
  );
}

function AcceptInvite({ id }: { id: string }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-muted">You were invited</span>
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await http.post(`/invitations/${id}/respond`, { accept: true });
            toast.success("You joined the project");
            await refresh();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Accept invitation
      </Button>
    </span>
  );
}
