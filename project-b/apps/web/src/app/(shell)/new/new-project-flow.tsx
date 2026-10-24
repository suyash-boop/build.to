"use client";

import {
  ProjectKey,
  slugify,
  suggestProjectKey,
  type GithubInstallationItem,
  type ImportableRepository,
  type ProjectStage,
  type Visibility,
} from "@bldt/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Link2, Lock, RefreshCw, Search, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GithubMark } from "@/components/domain/logo";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Checkbox, RadioCards, Segmented } from "@/components/ui/choice";
import { Field, Input } from "@/components/ui/input";
import { LoadError } from "@/components/ui/load-error";
import { Badge, EmptyState, Panel, Skeleton } from "@/components/ui/misc";
import { ApiError, errorMessage, http } from "@/lib/api.client";
import { cn } from "@/lib/utils";

const MAX_REPOS = 10;

export function NewProjectFlow({ username, host, githubConnected, startBlank }: { username: string; host: string; githubConnected: boolean; startBlank: boolean }) {
  const [mode, setMode] = useState<"import" | "blank">(startBlank || !githubConnected ? "blank" : "import");
  const [selected, setSelected] = useState<ImportableRepository[]>([]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Create a project</h2>
          <p className="mt-0.5 text-sm text-muted">A project is the unit everything hangs off: people, tasks, repositories, releases.</p>
        </div>
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            if (m === "blank") setSelected([]);
          }}
          options={[
            { value: "import", label: <><GithubMark className="size-3.5" /> Import repositories</> },
            { value: "blank", label: "Start blank" },
          ]}
        />
      </div>

      {mode === "import" && (
        <RepoPicker githubConnected={githubConnected} selected={selected} onChange={setSelected} />
      )}

      {(mode === "blank" || selected.length > 0) && <ProjectForm username={username} host={host} repos={selected} />}
    </div>
  );
}

/* ── Repository picker ───────────────────────────────────── */

export function RepoPicker({
  githubConnected,
  selected,
  onChange,
}: {
  githubConnected: boolean;
  selected: ImportableRepository[];
  onChange: (r: ImportableRepository[]) => void;
}) {
  const qc = useQueryClient();
  const installs = useQuery({
    queryKey: ["github", "installations"],
    queryFn: () => http.get<{ items: GithubInstallationItem[]; installUrl: string }>("/github/installations"),
    enabled: githubConnected,
    retry: false,
  });
  const [installationId, setInstallationId] = useState<number | null>(null);
  useEffect(() => {
    if (!installationId && installs.data?.items[0]) setInstallationId(installs.data.items[0].id);
  }, [installs.data, installationId]);

  const repos = useQuery({
    queryKey: ["github", "repos", installationId],
    queryFn: () => http.get<{ items: ImportableRepository[] }>(`/github/installations/${installationId}/repositories`),
    enabled: installationId != null,
  });

  const [q, setQ] = useState("");
  const [showForks, setShowForks] = useState(false);
  const list = useMemo(() => {
    const items = repos.data?.items ?? [];
    return items.filter(
      (r) => (showForks || !r.isFork) && (!q || r.fullName.toLowerCase().includes(q.toLowerCase()) || r.description?.toLowerCase().includes(q.toLowerCase())),
    );
  }, [repos.data, q, showForks]);

  const toggle = (r: ImportableRepository) => {
    const on = selected.some((s) => s.githubId === r.githubId);
    if (on) onChange(selected.filter((s) => s.githubId !== r.githubId));
    else if (selected.length < MAX_REPOS) onChange([...selected, r]);
    else toast.error(`A project can connect up to ${MAX_REPOS} repositories`);
  };

  const reauth = installs.error instanceof ApiError && installs.error.code === "github_reauth";

  if (!githubConnected || reauth) {
    return (
      <EmptyState
        icon={<GithubMark className="size-5" />}
        title={reauth ? "Reconnect GitHub" : "Connect GitHub to import"}
        action={
          <Button asChild variant="primary" size="sm">
            <a href="/projects/api/auth/github/login?next=/new">
              <GithubMark className="size-3.5" /> {reauth ? "Reconnect" : "Connect GitHub"}
            </a>
          </Button>
        }
      >
        {reauth ? "Your GitHub App authorization expired. Reconnect it to list repositories." : "Connect the GitHub App to your existing build.to account. You can also start a blank project without a repository."}
      </EmptyState>
    );
  }

  if (installs.isPending) {
    return (
      <Panel className="space-y-2 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </Panel>
    );
  }

  if (installs.isError) {
    return (
      <EmptyState title="Could not reach GitHub" action={<Button size="sm" onClick={() => installs.refetch()}><RefreshCw className="size-3.5" /> Try again</Button>}>
        {errorMessage(installs.error)}
      </EmptyState>
    );
  }

  const installUrl = installs.data.installUrl;
  if (installs.data.items.length === 0) {
    return (
      <EmptyState
        icon={<GithubMark className="size-5" />}
        title="Install the bld.t GitHub App"
        action={
          <div className="flex gap-2">
            <Button asChild variant="primary" size="sm">
              <a href={installUrl} target="_blank" rel="noopener noreferrer">
                Install on GitHub <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <Button size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["github"] })}>
              <RefreshCw className="size-3.5" /> I installed it
            </Button>
          </div>
        }
      >
        Choose the personal account or organization and pick the repositories to share. Access is read-only, and you can change the
        selection on GitHub at any time.
      </EmptyState>
    );
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {installs.data.items.map((i) => (
            <button
              key={i.id}
              onClick={() => setInstallationId(i.id)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md border px-2 text-sm",
                i.id === installationId ? "border-border-strong bg-surface-hover text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {i.accountLogin}
              {i.accountType === "Organization" && <span className="text-2xs text-faint">org</span>}
            </button>
          ))}
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-sm text-faint hover:text-fg"
          >
            Add account <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="ml-auto w-full sm:w-64">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter repositories" leading={<Search className="mr-2 size-3.5" />} aria-label="Filter repositories" />
        </div>
      </div>

      <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
        {repos.isPending ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : repos.isError ? (
          <LoadError title="Could not list repositories from GitHub" error={repos.error} onRetry={() => repos.refetch()} retrying={repos.isRefetching} className="py-10" />
        ) : list.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {q ? `No repositories match "${q}".` : "No repositories in this installation. Add some from the app settings on GitHub."}
          </p>
        ) : (
          list.map((r) => {
            const on = selected.some((s) => s.githubId === r.githubId);
            const primary = selected[0]?.githubId === r.githubId;
            return (
              <div
                key={r.githubId}
                role="button"
                tabIndex={0}
                onClick={() => toggle(r)}
                onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), toggle(r))}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-hover", on && "bg-surface-hover/60")}
              >
                <Checkbox checked={on} onChange={() => toggle(r)} label={`Select ${r.fullName}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.fullName}</span>
                    {r.isPrivate && <Lock className="size-3 text-faint" aria-label="Private" />}
                    {r.isArchived && <Badge>Archived</Badge>}
                    {r.isFork && <Badge>Fork</Badge>}
                    {primary && <Badge tone="accent">Primary</Badge>}
                  </div>
                  {r.description && <p className="truncate text-xs text-muted">{r.description}</p>}
                </div>
                <div className="hidden shrink-0 items-center gap-4 text-xs text-faint sm:flex">
                  {r.primaryLanguage && <span>{r.primaryLanguage}</span>}
                  {r.stars > 0 && (
                    <span className="flex items-center gap-1 tnum">
                      <Star className="size-3" /> {r.stars}
                    </span>
                  )}
                  {r.pushedAt && <RelativeTime iso={r.pushedAt} className="w-14 text-right tnum" />}
                </div>
                {r.connectedTo && (
                  <Link
                    href={`/${r.connectedTo.ownerUsername}/${r.connectedTo.slug}`}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-fg"
                    title="Already connected to this project"
                  >
                    in {r.connectedTo.name}
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-bg-subtle px-3 py-2 text-xs text-muted">
        <label className="flex items-center gap-2">
          <Checkbox checked={showForks} onChange={setShowForks} label="Show forks" /> Show forks
        </label>
        <span className="tnum">
          {selected.length === 0 ? "Select one or more repositories" : `${selected.length} selected. The first is the primary repository.`}
        </span>
      </div>
    </Panel>
  );
}

/* ── Project details ─────────────────────────────────────── */

function ProjectForm({ username, host, repos }: { username: string; host: string; repos: ImportableRepository[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const primary = repos[0];

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [key, setKey] = useState("");
  const [tagline, setTagline] = useState("");
  const [touched, setTouched] = useState({ name: false, slug: false, key: false, tagline: false });
  const [visibility, setVisibility] = useState<Visibility>("PRIVATE");
  const [stage, setStage] = useState<ProjectStage>("BUILDING");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Prefill from the primary repository until the user edits a field.
  useEffect(() => {
    if (!primary) return;
    const pretty = primary.name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    if (!touched.name) setName(pretty);
    if (!touched.tagline) setTagline(primary.description ?? "");
    if (!touched.slug) setSlug(slugify(primary.name));
    if (!touched.key) setKey(suggestProjectKey(primary.name));
    setVisibility(primary.isPrivate ? "PRIVATE" : "PUBLIC");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary?.githubId]);

  const onName = (v: string) => {
    setName(v);
    setTouched((t) => ({ ...t, name: true }));
    if (!touched.slug) setSlug(slugify(v));
    if (!touched.key) setKey(suggestProjectKey(v || "project"));
  };

  const keyValid = ProjectKey.safeParse(key).success;
  const anyPrivate = repos.some((r) => r.isPrivate);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!name.trim()) return setErrors({ name: "Give the project a name" });
    if (!keyValid) return setErrors({ key: "2 to 10 letters or digits, starting with a letter" });
    setBusy(true);
    try {
      const res = await http.post<{ owner: string; slug: string }>("/projects", {
        name: name.trim(),
        slug: slug || undefined,
        key,
        tagline: tagline || undefined,
        visibility,
        stage,
        repositoryGithubIds: repos.map((r) => r.githubId),
      });
      await qc.invalidateQueries({ queryKey: ["me", "projects"] });
      toast.success(repos.length ? "Project created. Syncing repositories now." : "Project created");
      router.push(`/${res.owner}/${res.slug}`);
      router.refresh();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        const fe = err.fieldErrors();
        if (Object.keys(fe).length) return setErrors(fe);
      }
      toast.error(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <Panel className="p-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Name" error={errors.name}>
            {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={Boolean(errors.name)} value={name} onChange={(e) => onName(e.target.value)} placeholder="Project name" autoFocus={!primary} maxLength={80} />}
          </Field>
          <Field label="URL" error={errors.slug} hint="Lowercase letters, numbers, dots and hyphens.">
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                aria-invalid={Boolean(errors.slug)}
                leading={`${host}/projects/${username}/`}
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "-"));
                  setTouched((t) => ({ ...t, slug: true }));
                }}
                maxLength={64}
              />
            )}
          </Field>
          <Field label="Task key" error={errors.key} hint={<>Tasks will be numbered <span className="font-mono">{(keyValid ? key : "KEY") + "-1"}</span>, <span className="font-mono">{(keyValid ? key : "KEY") + "-2"}</span>. Used to link pull requests.</>}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                aria-invalid={Boolean(errors.key) || (key.length > 0 && !keyValid)}
                className="font-mono uppercase"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10));
                  setTouched((t) => ({ ...t, key: true }));
                }}
              />
            )}
          </Field>
          <Field label="Stage" hint="Where the project is today. Shipping later records the date.">
            {() => (
              <Segmented
                value={stage}
                onChange={setStage}
                options={[
                  { value: "IDEA", label: "Idea" },
                  { value: "BUILDING", label: "Building" },
                ]}
              />
            )}
          </Field>
          <Field label="One-line description" optional className="md:col-span-2" error={errors.tagline}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                value={tagline}
                onChange={(e) => {
                  setTagline(e.target.value);
                  setTouched((t) => ({ ...t, tagline: true }));
                }}
                placeholder="What it does, for whom"
                maxLength={160}
              />
            )}
          </Field>
        </div>
      </Panel>

      <div>
        <p className="mb-2 text-sm font-medium">Visibility</p>
        <RadioCards
          name="Visibility"
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "PRIVATE", title: "Private", description: "Only members can see the project. It still counts, unnamed, on members' profiles.", icon: <Lock className="size-4" /> },
            { value: "UNLISTED", title: "Unlisted", description: "Anyone with the link can view it. Never listed in discovery or search.", icon: <Link2 className="size-4" /> },
            { value: "PUBLIC", title: "Public", description: "Listed in discovery and shown on members' profiles. Tasks stay members-only.", icon: <Globe className="size-4" /> },
          ]}
        />
        {visibility !== "PRIVATE" && anyPrivate && (
          <p className="mt-2 text-xs text-warning">
            A selected repository is private on GitHub. Visitors will see the project, but not that repository's name, README, or sync status.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-5">
        <Button asChild variant="ghost">
          <Link href="/home">Cancel</Link>
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {repos.length ? `Create and import ${repos.length === 1 ? "repository" : `${repos.length} repositories`}` : "Create project"}
        </Button>
      </div>
    </form>
  );
}
