import type { ActivityItem, Paginated, ProjectBriefItem, ProjectDetail, SignalItem } from "@bldt/contracts";
import { AlertCircle, ArrowRight, CircleDashed, ExternalLink, Lock, RefreshCw } from "lucide-react";
import Link from "next/link";
import { ActivityFeed } from "@/components/domain/activity";
import { GithubMark } from "@/components/domain/logo";
import { Markdown } from "@/components/domain/markdown";
import { TechChip } from "@/components/domain/status";
import { RelativeTime } from "@/components/domain/time";
import { PageBody } from "@/components/shell/page";
import { Avatar, Panel, SectionHeader } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/overlay";
import { api } from "@/lib/api.server";
import { can, getProject } from "@/lib/project.server";
import { cn, dueState, isHttpUrl, plural, shortDate } from "@/lib/utils";
import { BriefCard } from "./brief-card";
import { SignalsCard } from "./signals-card";
import { OnlineNow } from "./online-now";
import { getMe } from "@/lib/api.server";

export default async function ProjectOverview({ params }: PageProps<"/[username]/[project]">) {
  const { username, project } = await params;
  const p = await getProject(username, project);
  const base = `/${p.owner.username}/${p.slug}`;
  const member = can(p, "tasks.view");
  const me = await getMe();
  const [activity, brief, signals] = await Promise.all([
    api<Paginated<ActivityItem>>(`/projects/${p.owner.username}/${p.slug}/activity?limit=10`),
    // Briefs are a members-only workspace aid; they mention task titles and assignees.
    member
      ? api<{ brief: ProjectBriefItem | null; enabled: boolean }>(`/projects/${p.owner.username}/${p.slug}/brief`)
      : Promise.resolve(null),
    member ? api<{ open: SignalItem[]; snoozed: SignalItem[] }>(`/projects/${p.owner.username}/${p.slug}/signals`) : Promise.resolve(null),
  ]);
  const primary = p.repositories.find((r) => r.isPrimary) ?? p.repositories[0];
  const body = p.description ?? p.readme;
  const readmeBase = primary ? `${primary.htmlUrl}/raw/${primary.defaultBranch}/` : undefined;

  return (
    <PageBody>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          {(p.stage === "PAUSED" || p.stage === "SUNSET") && (
            <Panel className="border-l-2 border-l-st-paused px-4 py-3">
              <p className="text-sm font-medium">{p.stage === "SUNSET" ? `This project was wound down${p.sunsetAt ? ` on ${shortDate(p.sunsetAt)}` : ""}.` : "This project is paused."}</p>
              {p.retrospective && <p className="mt-1 whitespace-pre-line text-sm text-muted">{p.retrospective}</p>}
            </Panel>
          )}

          {signals && (
            <SignalsCard
              owner={p.owner.username}
              slug={p.slug}
              initialOpen={signals.open}
              initialSnoozed={signals.snoozed}
              canSnooze={can(p, "tasks.update")}
              canConfigure={can(p, "project.update")}
            />
          )}

          {brief && (brief.enabled || brief.brief) && (
            <BriefCard owner={p.owner.username} slug={p.slug} initial={brief.brief} canGenerate={brief.enabled && can(p, "tasks.create")} />
          )}

          {p.activeMilestone && <MilestoneCard project={p} base={base} />}

          <section>
            <SectionHeader
              title={p.description ? "About" : "README"}
              action={
                !p.description && primary && p.readme ? (
                  <a href={`${primary.htmlUrl}#readme`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-faint hover:text-fg">
                    {primary.fullName} <ExternalLink className="size-3" />
                  </a>
                ) : undefined
              }
            />
            {body ? (
              <Panel className="px-5 py-4 md:px-6 md:py-5">
                <Markdown baseUrl={p.description ? undefined : readmeBase}>{body}</Markdown>
              </Panel>
            ) : (
              <Panel className="px-5 py-8 text-center text-sm text-muted">
                {can(p, "project.update") ? (
                  <>
                    No description yet. <Link href={`${base}/settings`} className="text-fg underline underline-offset-2">Write one</Link>, or connect a repository to show its README.
                  </>
                ) : (
                  "No description yet."
                )}
              </Panel>
            )}
          </section>

          <section>
            <SectionHeader
              title="Recent activity"
              action={
                <Link href={`${base}/activity`} className="flex items-center gap-1 text-xs text-faint hover:text-fg">
                  All activity <ArrowRight className="size-3" />
                </Link>
              }
            />
            <Panel className="px-4 py-2">
              <ActivityFeed items={activity.items} compact emptyText="Nothing yet. Activity from bld.t and GitHub shows up here." />
            </Panel>
          </section>
        </div>

        <aside className="min-w-0 space-y-7">
          {member && p.viewer.role && me && <OnlineNow owner={p.owner.username} slug={p.slug} viewerId={me.id} />}
          <Stats p={p} />

          {p.openToContributors && p.visibility === "PUBLIC" && (
            <section>
              <SectionHeader title="Looking for" />
              <div className="flex flex-wrap gap-1.5">
                {p.lookingFor.length ? (
                  p.lookingFor.map((r) => (
                    <span key={r} className="rounded-md border border-border px-2 py-0.5 text-xs text-fg">{r}</span>
                  ))
                ) : (
                  <span className="text-sm text-muted">Open to contributors</span>
                )}
              </div>
            </section>
          )}

          {p.allTechnologies.length > 0 && (
            <section>
              <SectionHeader title="Stack" />
              <div className="flex flex-wrap gap-1">
                {p.allTechnologies
                  .filter((t) => !t.hidden)
                  .map((t) => (
                    <Tooltip
                      key={t.slug}
                      content={
                        t.source === "DETECTED" ? (
                          <>Detected in <span className="font-mono">{t.evidence}</span>{t.share > 0 && <> · {(t.share * 100).toFixed(t.share < 0.1 ? 1 : 0)}% of code</>}</>
                        ) : (
                          <>Added by the team{t.evidence && <>, confirmed in <span className="font-mono">{t.evidence}</span></>}</>
                        )
                      }
                    >
                      <span>
                        <TechChip tech={t} />
                      </span>
                    </Tooltip>
                  ))}
              </div>
              <LanguageBar techs={p.allTechnologies} />
            </section>
          )}

          <section>
            <SectionHeader
              title="Team"
              count={p.memberCount}
              action={
                <Link href={`${base}/people`} className="text-xs text-faint hover:text-fg">
                  View all
                </Link>
              }
            />
            <ul className="space-y-1.5">
              {p.members.map((m) => (
                <li key={m.id}>
                  <Link href={`/${m.username}`} className="flex items-center gap-2 rounded-md text-sm hover:text-fg">
                    <Avatar user={m} size={20} />
                    <span className="truncate">{m.displayName}</span>
                    <span className="truncate text-xs text-faint">@{m.username}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {p.repositories.length > 0 && (
            <section>
              <SectionHeader title="Repositories" />
              <ul className="space-y-2">
                {p.repositories.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 text-sm">
                    <GithubMark className="mt-0.5 size-3.5 shrink-0 text-faint" />
                    <div className="min-w-0 flex-1">
                      <a href={r.htmlUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate hover:underline">
                        <span className="truncate">{r.fullName}</span>
                        {r.isPrivate && <Lock className="size-3 shrink-0 text-faint" aria-label="Private" />}
                      </a>
                      <SyncLine r={r} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {p.latestDeployments.length > 0 && (
            <section>
              <SectionHeader title="Environments" />
              <ul className="space-y-1.5">
                {p.latestDeployments.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        d.state === "SUCCESS" ? "bg-success" : d.state === "FAILURE" || d.state === "ERROR" ? "bg-danger" : d.state === "INACTIVE" ? "bg-faint" : "bg-warning",
                      )}
                      aria-label={d.state.toLowerCase()}
                    />
                    {isHttpUrl(d.url) ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{d.environment}</a>
                    ) : (
                      <span className="truncate">{d.environment}</span>
                    )}
                    <span className="ml-auto font-mono text-2xs text-faint">{d.sha.slice(0, 7)}</span>
                    <RelativeTime iso={d.updatedAt} className="w-10 text-right text-2xs text-faint" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </PageBody>
  );
}

function Stats({ p }: { p: ProjectDetail }) {
  // GitHub-derived numbers only mean something once a repository is connected.
  const github = p.repositories.length > 0;
  const rows: [string, number | string][] = [
    ...(p.viewer.role ? ([["Open tasks", p.stats.openTasks]] as [string, number][]) : []),
    ["Tasks done", p.stats.doneTasks],
    ...(github ? ([["Merged pull requests", p.stats.mergedPrs]] as [string, number][]) : []),
    ["Releases", p.stats.releases],
    ...(github ? ([["Contributors on GitHub", p.stats.contributors]] as [string, number][]) : []),
  ];
  return (
    <section>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {rows.map(([label, value]) => (
          <div key={label} className="bg-surface px-3 py-2.5">
            <dt className="text-2xs text-faint">{label}</dt>
            <dd className="mt-0.5 text-base font-medium tnum">{value}</dd>
          </div>
        ))}
        <div className={cn("bg-surface px-3 py-2.5", rows.length % 2 === 0 && "col-span-2")}>
          <dt className="text-2xs text-faint">{p.shippedAt ? "Shipped" : "Started"}</dt>
          <dd className="mt-0.5 text-base font-medium tnum">{shortDate(p.shippedAt ?? p.createdAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

function LanguageBar({ techs }: { techs: ProjectDetail["allTechnologies"] }) {
  const langs = techs.filter((t) => t.category === "LANGUAGE" && t.share > 0 && !t.hidden);
  if (langs.length < 1) return null;
  const total = langs.reduce((a, t) => a + t.share, 0);
  return (
    <div className="mt-3">
      <div className="flex h-1.5 overflow-hidden rounded-sm bg-surface-2" role="img" aria-label="Language breakdown">
        {langs.map((t) => (
          <span key={t.slug} style={{ width: `${(t.share / total) * 100}%`, background: t.color ?? "var(--text-faint)" }} className="h-full first:rounded-l-sm last:rounded-r-sm" />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-faint">
        {langs.slice(0, 5).map((t) => (
          <span key={t.slug} className="tnum">
            {t.name} {((t.share / total) * 100).toFixed(1)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function SyncLine({ r }: { r: ProjectDetail["repositories"][number] }) {
  if (r.syncStatus === "FAILED") {
    return (
      <p className="flex items-center gap-1 text-xs text-danger">
        <AlertCircle className="size-3" /> {r.syncError ?? "Sync failed"}
      </p>
    );
  }
  if (r.syncStatus === "SYNCING" || r.syncStatus === "QUEUED" || !r.lastSyncedAt) {
    return (
      <p className="flex items-center gap-1 text-xs text-faint">
        {r.syncStatus === "SYNCING" ? <RefreshCw className="size-3 animate-spin" /> : <CircleDashed className="size-3" />}
        {r.syncStatus === "SYNCING" ? "Syncing" : "Waiting to sync"}
      </p>
    );
  }
  return (
    <p className="text-xs text-faint">
      Synced <RelativeTime iso={r.lastSyncedAt} />
      {r.primaryLanguage && <> · {r.primaryLanguage}</>}
      {r.isPrimary && <> · primary</>}
    </p>
  );
}

function MilestoneCard({ project: p, base }: { project: ProjectDetail; base: string }) {
  const m = p.activeMilestone!;
  const pct = m.taskCounts.total ? Math.round((m.taskCounts.done / m.taskCounts.total) * 100) : 0;
  const due = dueState(m.dueOn);
  return (
    <Link href={`${base}/milestones`} className="block rounded-lg border border-border bg-surface px-4 py-3.5 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-medium uppercase tracking-wide text-faint">{m.status === "ACTIVE" ? "Current milestone" : "Next milestone"}</p>
          <p className="mt-0.5 truncate text-sm font-medium">{m.title}</p>
        </div>
        <div className="shrink-0 text-right text-xs">
          <p className="tnum text-fg">{m.taskCounts.done}/{plural(m.taskCounts.total, "task")}</p>
          {m.dueOn && <p className={cn("tnum", due === "overdue" ? "text-danger" : due === "soon" ? "text-warning" : "text-faint")}>Due {shortDate(m.dueOn)}</p>}
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-sm bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-st-shipped" style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}
