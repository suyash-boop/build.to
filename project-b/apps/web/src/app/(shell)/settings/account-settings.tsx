"use client";

import type { Me, SidebarProject, WorkRecordItem } from "@bldt/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Code2, Download, ExternalLink, Lock, Monitor, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { GithubMark } from "@/components/domain/logo";
import { StageGlyph } from "@/components/domain/status";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Avatar, Badge, Panel } from "@/components/ui/misc";
import { ApiError, errorMessage, http } from "@/lib/api.client";
import { WorkRecordsSection } from "./work-records-section";
import { EditorsSection } from "./editors-section";

export interface SessionRow {
  id: string;
  current: boolean;
  kind: "BROWSER" | "DEVICE";
  clientName: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function AccountSettings({
  me,
  projects,
  sessions,
  records,
  extensionPublished,
}: {
  me: Me;
  projects: SidebarProject[];
  sessions: SessionRow[];
  records: { items: WorkRecordItem[]; enabled: boolean };
  extensionPublished: boolean;
}) {
  return (
    <div className="space-y-10">
      <ProfileForm me={me} />
      <ProfileProjects projects={projects} />
      <GithubSection me={me} />
      <EditorsSection sessions={sessions} published={extensionPublished} />
      <WorkRecordsSection projects={projects} initial={records} githubLinked={Boolean(me.githubLogin)} />
      <Sessions sessions={sessions} />
      <DataSection />
      <Panel className="p-4 text-sm text-muted">Your account is shared with the community. <a href="/settings" className="font-medium text-primary underline">Manage your build.to profile</a>. Workspace settings never delete your articles or your shared identity.</Panel>
    </div>
  );
}

function ProfileForm({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState({
    displayName: me.displayName,
    username: me.username,
    headline: me.headline ?? "",
    bio: me.bio ?? "",
    location: me.location ?? "",
    websiteUrl: me.websiteUrl ?? "",
    focusAreas: me.focusAreas.join(", "),
    openToWork: me.openToWork,
    meetingUrl: me.meetingUrl ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await http.patch("/me", {
        ...f,
        meetingUrl: f.meetingUrl.trim() || null,
        focusAreas: f.focusAreas
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 6),
      });
      toast.success("Profile saved");
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) setErrors(err.fieldErrors());
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Profile" description="What people see on your public profile.">
      <form onSubmit={submit}>
        <Panel className="space-y-5 p-5">
          <div className="flex items-center gap-3">
            <Avatar user={me} size={44} />
            <p className="text-xs text-muted">Your profile is shared with the community. <a href="/settings" className="text-primary underline">Change your avatar and social links</a>.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" error={errors.displayName}>{(id) => <Input id={id} value={f.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={80} required />}</Field>
            <Field label="Username" error={errors.username} hint="Shared with your articles. This address cannot be changed here.">
              {(id, d) => <Input id={id} aria-describedby={d} leading="@" value={f.username} readOnly />}
            </Field>
          </div>
          <Field label="Headline" optional error={errors.headline}>{(id) => <Input id={id} value={f.headline} onChange={(e) => set("headline", e.target.value)} maxLength={120} placeholder="Backend engineer, distributed systems" />}</Field>
          <Field label="Bio" optional error={errors.bio} hint={`${f.bio.length}/200`}>{(id, d) => <Textarea id={id} aria-describedby={d} value={f.bio} onChange={(e) => set("bio", e.target.value)} rows={4} maxLength={200} />}</Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Location" optional>{(id) => <Input id={id} value={f.location} onChange={(e) => set("location", e.target.value)} maxLength={80} />}</Field>
            <Field label="Website" optional error={errors.websiteUrl}>{(id) => <Input id={id} type="url" value={f.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://" />}</Field>
          </div>
          <Field label="Focus areas" optional hint="Comma separated, up to six. For example: backend, infrastructure, developer tools.">
            {(id, d) => <Input id={id} aria-describedby={d} value={f.focusAreas} onChange={(e) => set("focusAreas", e.target.value)} />}
          </Field>
          <Field label="Meeting link" optional error={errors.meetingUrl} hint="Your Google Meet, Zoom, or Whereby room. Huddles you start use it; without one, bld.t opens a fresh Jitsi room.">
            {(id, d) => <Input id={id} aria-describedby={d} type="url" value={f.meetingUrl} onChange={(e) => set("meetingUrl", e.target.value)} placeholder="https://meet.google.com/..." />}
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
            <div>
              <p className="text-sm font-medium">Open to work</p>
              <p className="text-xs text-muted">Shows a badge on your profile. Nothing else changes.</p>
            </div>
            <Switch checked={f.openToWork} onChange={(v) => set("openToWork", v)} label="Open to work" />
          </div>
        </Panel>
        <div className="mt-3 flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>Save profile</Button>
        </div>
      </form>
    </Section>
  );
}

function ProfileProjects({ projects }: { projects: SidebarProject[] }) {
  const router = useRouter();
  const [state, setState] = useState(() => Object.fromEntries(projects.map((p) => [p.id, p.showOnProfile])));
  if (projects.length === 0) return null;
  const toggle = async (p: SidebarProject, show: boolean) => {
    setState((s) => ({ ...s, [p.id]: show }));
    try {
      await http.patch(`/projects/${p.ownerUsername}/${p.slug}/membership`, { showOnProfile: show });
      router.refresh();
    } catch (err) {
      setState((s) => ({ ...s, [p.id]: !show }));
      toast.error(errorMessage(err));
    }
  };
  return (
    <Section
      title="Projects on your profile"
      description="Public projects are listed by name. Private and unlisted ones only add to an anonymous count. Turn a project off to leave it out completely."
    >
      <Panel className="divide-y divide-border">
        {projects.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <StageGlyph stage={p.stage} size={9} />
            <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
            {p.visibility !== "PUBLIC" && (
              <span className="flex items-center gap-1 text-xs text-faint">
                <Lock className="size-3" /> {p.visibility === "PRIVATE" ? "Counted, not named" : "Unlisted, counted"}
              </span>
            )}
            <Switch checked={state[p.id] ?? true} onChange={(v) => toggle(p, v)} label={`Show ${p.name} on profile`} />
          </div>
        ))}
      </Panel>
    </Section>
  );
}

function GithubSection({ me }: { me: Me }) {
  if (!me.features.githubApp) return <Section title="GitHub App" description="Repository sync is optional and separate from your build.to login."><Panel className="p-5 text-sm leading-relaxed text-muted">This local setup does not have a GitHub App configured yet. Projects, tasks, discussions, and team invitations work without it. To enable repository import, add the <code className="font-mono text-xs">GITHUB_APP_*</code> settings from <code className="font-mono text-xs">.env.example</code> and restart the development launcher.</Panel></Section>;
  return (
    <Section title="GitHub App" description="Connect repositories to your existing build.to account. Access is granted per installation.">
      <Panel className="divide-y divide-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <GithubMark className="size-4" />
          <div className="min-w-0 flex-1">
            {me.githubLogin ? (
              <p className="text-sm">
                Connected as <span className="font-medium">{me.githubLogin}</span>
              </p>
            ) : (
              <p className="text-sm text-muted">Not connected</p>
            )}
          </div>
          <Button asChild size="xs">
            <a href="/projects/api/auth/github/login?next=/settings">{me.githubLogin ? "Refresh connection" : "Connect"}</a>
          </Button>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm">Repository access</p>
            <p className="text-xs text-muted">Add or remove repositories, or uninstall the app, on GitHub.</p>
          </div>
          <Button asChild size="xs" variant="ghost">
            <a href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer">
              Manage on GitHub <ExternalLink className="size-3" />
            </a>
          </Button>
        </div>
      </Panel>
    </Section>
  );
}

function describeAgent(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) ? "macOS" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobile|iPhone|Android/.test(ua) };
}

function Sessions({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const revoke = async (id: string) => {
    try {
      await http.del(`/me/sessions/${id}`);
      toast.success("Session signed out");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Section title="Sessions" description="Browsers and editors signed in to your account. Signing one out takes effect immediately.">
      <Panel className="divide-y divide-border">
        {sessions.map((s) => {
          const a = s.kind === "DEVICE" ? { label: s.clientName ?? "Editor extension", mobile: false } : describeAgent(s.userAgent);
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              {s.kind === "DEVICE" ? <Code2 className="size-4 text-faint" /> : a.mobile ? <Smartphone className="size-4 text-faint" /> : <Monitor className="size-4 text-faint" />}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm">
                  {a.label} {s.current && <Badge tone="success">This device</Badge>}
                </p>
                <p className="text-xs text-faint">
                  {s.ip ?? "Unknown IP"} · signed in <RelativeTime iso={s.createdAt} />
                  {s.lastSeenAt && <> · active <RelativeTime iso={s.lastSeenAt} /></>}
                </p>
              </div>
              {!s.current && (
                <Button size="xs" variant="ghost" onClick={() => revoke(s.id)}>{s.kind === "DEVICE" ? "Disconnect" : "Sign out"}</Button>
              )}
            </div>
          );
        })}
      </Panel>
    </Section>
  );
}

function DataSection() {
  return (
    <Section title="Workspace data" description="Download your project memberships, tasks, workspace comments, contributions, notifications, devices, and signed work records.">
      <Button asChild size="sm">
        <a href="/projects/api/me/export" download>
          <Download className="size-3.5" /> Export data
        </a>
      </Button>
    </Section>
  );
}

function DeleteAccount({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <Section title="Delete account">
      <Panel className="flex flex-wrap items-center justify-between gap-3 border-danger/30 px-4 py-3">
        <p className="max-w-md text-sm text-muted">
          Removes your profile, signs you out everywhere, and disconnects GitHub. Projects you own alone are deleted. If you own projects with
          other members, transfer them first.
        </p>
        <Button size="sm" variant="danger" onClick={() => setOpen(true)}>Delete account</Button>
      </Panel>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your account?"
        description="This cannot be undone. Contributions on shared projects stay in their history without your name."
        confirmLabel="Delete account"
        destructive
        typeToConfirm={me.username}
        onConfirm={async () => {
          await http.del("/me", { confirm: me.username });
          qc.clear();
          router.replace("/");
          router.refresh();
        }}
      />
    </Section>
  );
}
