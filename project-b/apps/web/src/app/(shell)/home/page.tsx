import type { HomeData } from "@bldt/contracts";
import { CalendarClock, GitBranch, Plus, ServerCrash, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActivityFeed } from "@/components/domain/activity";
import { SignalIcon, signalDetail, signalHref } from "@/components/domain/signal";
import { PriorityIcon, StageBadge, StatusIcon, TechChip } from "@/components/domain/status";
import { RelativeTime } from "@/components/domain/time";
import { MobileTitle, PageBody, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { AvatarStack, Panel, SectionHeader } from "@/components/ui/misc";
import { api, requireMe } from "@/lib/api.server";
import { cn, dueState, plural, shortDate } from "@/lib/utils";
import { AttentionActions } from "./attention-actions";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const me = await requireMe("/home");
  const data = await api<HomeData>("/home");
  const a = data.attention;
  // Failing deploys and overdue milestones already have their own rows below.
  const signals = data.signals.filter((s) => s.type !== "deploy.failing" && !(s.type === "milestone.at_risk" && s.data.overdue));
  const attentionCount =
    a.invitations.length + a.joinRequests.length + signals.length + a.failingDeployments.length + a.failedSyncs.length + a.overdueMilestones.length;

  if (data.activeProjects.length === 0 && a.invitations.length === 0) {
    return (
      <>
        <PageHeader title="Home" />
        <MobileTitle>Home</MobileTitle>
        <PageBody width="narrow">
          <Onboarding name={me.displayName.split(" ")[0] ?? me.displayName} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Home"
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/new">
              <Plus className="size-3.5" /> New project
            </Link>
          </Button>
        }
      />
      <MobileTitle>Home</MobileTitle>
      <PageBody>
        <section className="workspace-hero mb-7 rounded-xl border border-border bg-surface p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your build space</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
            <div><h2 className="text-2xl font-bold tracking-tight">Keep good work moving, {me.displayName.split(" ")[0]}.</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">A little less coordination. A little more building. Your projects, teammates, and next steps, together.</p></div>
            <Button asChild variant="primary" size="lg"><Link href="/new?blank=1"><Plus className="size-4" /> Start a project</Link></Button>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-4 border-t border-border pt-5">
            {[{ label: "Active projects", value: data.activeProjects.length }, { label: "Assigned to you", value: data.myTasks.length }, { label: "Need attention", value: attentionCount }].map((stat) => <div key={stat.label}><p className="text-2xl font-bold tabular-nums">{stat.value}</p><p className="mt-1 text-xs text-muted">{stat.label}</p></div>)}
          </div>
        </section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-8">
            {attentionCount > 0 && (
              <section>
                <SectionHeader title="Needs attention" count={attentionCount} />
                <Panel className="divide-y divide-border">
                  {a.invitations.map((inv) => (
                    <AttentionRow key={inv.id} icon={<UserPlus className="size-4 text-accent" />}>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{inv.inviter.displayName}</span> invited you to{" "}
                        <span className="font-medium">{inv.project.name}</span> as {inv.role.toLowerCase()}
                      </span>
                      <AttentionActions kind="invitation" id={inv.id} owner={inv.project.owner.username} slug={inv.project.slug} />
                    </AttentionRow>
                  ))}
                  {a.joinRequests.map((r) => (
                    <AttentionRow key={r.id} icon={<UserPlus className="size-4 text-muted" />}>
                      <span className="min-w-0 flex-1">
                        <Link href={`/${r.user.username}`} className="font-medium hover:underline">{r.user.displayName}</Link> asked to join{" "}
                        <Link href={`/${r.project.ownerUsername}/${r.project.slug}/people`} className="font-medium hover:underline">{r.project.name}</Link>
                        {r.roleWanted && <span className="text-muted"> as {r.roleWanted}</span>}
                        <span className="mt-0.5 block truncate text-xs text-muted">“{r.message}”</span>
                      </span>
                      <AttentionActions kind="request" id={r.id} owner={r.project.ownerUsername} slug={r.project.slug} />
                    </AttentionRow>
                  ))}
                  {signals.map((s) => {
                    const { href, external } = signalHref(s);
                    const detail = signalDetail(s);
                    return (
                      <AttentionRow key={s.id} icon={<SignalIcon signal={s} className="size-4" />}>
                        <span className="min-w-0 flex-1">
                          {external ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">{s.title}</a>
                          ) : (
                            <Link href={href} className="hover:underline">{s.title}</Link>
                          )}
                          <span className="mt-0.5 block truncate text-xs text-faint">
                            {s.project.name}
                            {detail && <> · {detail}</>}
                          </span>
                        </span>
                        <RelativeTime iso={s.firstSeenAt} className="shrink-0 text-xs text-faint" />
                      </AttentionRow>
                    );
                  })}
                  {a.failingDeployments.map((d) => (
                    <AttentionRow key={d.id} icon={<ServerCrash className="size-4 text-danger" />}>
                      <span className="min-w-0 flex-1">
                        Deployment to <span className="font-medium">{d.environment}</span> failed in{" "}
                        <Link href={`/${d.project.ownerUsername}/${d.project.slug}/releases`} className="font-medium hover:underline">{d.project.name}</Link>
                        <span className="ml-1.5 font-mono text-xs text-faint">{d.sha.slice(0, 7)}</span>
                      </span>
                      <RelativeTime iso={d.updatedAt} className="text-xs text-faint" />
                    </AttentionRow>
                  ))}
                  {a.failedSyncs.map((s) => (
                    <AttentionRow key={s.repository} icon={<GitBranch className="size-4 text-warning" />}>
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-xs">{s.repository}</span> stopped syncing
                        <span className="mt-0.5 block text-xs text-muted">{s.error}</span>
                      </span>
                      <Button asChild size="xs">
                        <Link href={`/${s.project.ownerUsername}/${s.project.slug}/settings#integrations`}>Fix</Link>
                      </Button>
                    </AttentionRow>
                  ))}
                  {a.overdueMilestones.map((m) => (
                    <AttentionRow key={m.id} icon={<CalendarClock className="size-4 text-warning" />}>
                      <span className="min-w-0 flex-1">
                        <Link href={`/${m.project.ownerUsername}/${m.project.slug}/milestones`} className="font-medium hover:underline">{m.title}</Link>{" "}
                        in {m.project.name} was due {m.dueOn ? shortDate(m.dueOn) : ""}
                        <span className="ml-1.5 text-xs text-muted tnum">{m.taskCounts.done}/{m.taskCounts.total} done</span>
                      </span>
                    </AttentionRow>
                  ))}
                </Panel>
              </section>
            )}

            <section>
              <SectionHeader title="Assigned to you" count={data.myTasks.length} />
              {data.myTasks.length === 0 ? (
                <Panel className="px-4 py-6 text-center text-sm text-muted">Nothing assigned. Pick something up from a project board.</Panel>
              ) : (
                <Panel className="divide-y divide-border overflow-hidden">
                  {data.myTasks.map((t) => {
                    const due = dueState(t.dueOn);
                    return (
                      <Link
                        key={t.id}
                        href={`/${t.project.ownerUsername}/${t.project.slug}/tasks?task=${t.number}`}
                        className="flex h-10 items-center gap-3 px-3 text-sm hover:bg-surface-hover"
                      >
                        <PriorityIcon priority={t.priority} />
                        <StatusIcon status={t.status} />
                        <span className="w-16 shrink-0 font-mono text-xs text-faint">{t.identifier}</span>
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.dueOn && (
                          <span className={cn("hidden shrink-0 text-xs tnum sm:inline", due === "overdue" ? "text-danger" : due === "soon" ? "text-warning" : "text-faint")}>
                            {shortDate(t.dueOn)}
                          </span>
                        )}
                        <span className="hidden w-32 shrink-0 truncate text-right text-xs text-faint md:inline">{t.project.name}</span>
                      </Link>
                    );
                  })}
                </Panel>
              )}
            </section>

            <section>
              <SectionHeader title="Your projects" count={data.activeProjects.length} />
              <div className="grid gap-3 sm:grid-cols-2">
                {data.activeProjects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/${p.owner.username}/${p.slug}`}
                    className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="truncate font-mono text-2xs text-faint">
                          {p.owner.username}/{p.slug}
                        </p>
                      </div>
                      <StageBadge stage={p.stage} />
                    </div>
                    {p.tagline && <p className="mt-2 line-clamp-2 text-sm text-muted">{p.tagline}</p>}
                    <div className="mt-3 flex flex-wrap gap-1">
                      {p.technologies.slice(0, 4).map((t) => (
                        <TechChip key={t.slug} tech={t} />
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-muted">
                      <span className="tnum">
                        {plural(p.openTasks, "open task")}
                        {p.myOpenTasks > 0 && <span className="text-fg"> · {p.myOpenTasks} yours</span>}
                      </span>
                      <AvatarStack users={p.members} max={4} size={18} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          <aside className="min-w-0">
            <SectionHeader title="Recent activity" />
            <Panel className="px-4 py-2">
              <ActivityFeed items={data.activity} showProject compact limit={12} emptyText="Activity from your projects will appear here." />
            </Panel>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

function AttentionRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      {children}
    </div>
  );
}

function Onboarding({ name }: { name: string }) {
  const steps = [
    {
      title: "Give your next idea a home",
      body: "Start a project, bring your team, and plan your first milestone. Connect a GitHub repository whenever you are ready.",
      action: (
        <Button asChild variant="primary" size="sm">
          <Link href="/new?blank=1">Create your first project</Link>
        </Button>
      ),
    },
    {
      title: "Plan the next milestone",
      body: "Add a few tasks. Each project gets a short key, so tasks read like KEY-12. Put a task id in a pull request or branch name and the task moves to review on its own, then to done when the PR merges with “fixes KEY-12”.",
    },
    {
      title: "Invite the people you build with",
      body: "Give collaborators a role per project. Their merged PRs and reviews show up on their profiles too.",
    },
    {
      title: "Ship it",
      body: "Publish a GitHub release or mark a ship in bld.t. It goes on the record of everyone who worked on it.",
    },
  ];
  return (
    <div className="workspace-hero rounded-xl border border-border bg-surface p-6 md:p-10">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Welcome, {name}</p>
      <h2 className="mt-2 text-2xl font-bold tracking-tight">Good things start with a build.</h2>
      <p className="mt-1.5 max-w-lg text-sm text-muted">
        This is the building side of build.to. Same account, same community. A dedicated space to turn your ideas into something real.
      </p>
      <ol className="mt-8 space-y-0">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-4 pb-7 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[11px] top-7 bottom-0 w-px bg-border" aria-hidden />}
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-xs text-muted">
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
              {s.action && <div className="mt-3">{s.action}</div>}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-xs text-faint">
        Prefer to start from scratch?{" "}
        <Link href="/new?blank=1" className="text-muted underline underline-offset-2 hover:text-fg">
          Create a project without a repository
        </Link>
      </p>
    </div>
  );
}
