import type { ProjectInsights } from "@bldt/contracts";
import { PRIORITY_LABEL } from "@bldt/contracts";
import { AlertTriangle, CircleCheck, CircleX, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BurnupChart, ColumnChart, ForecastStrip } from "@/components/charts/charts";
import { Stat, formatDuration } from "@/components/charts/stat";
import { PriorityIcon, StatusIcon } from "@/components/domain/status";
import { PageBody } from "@/components/shell/page";
import { Avatar, Badge, Panel, SectionHeader } from "@/components/ui/misc";
import { api } from "@/lib/api.server";
import { getProject, requirePermission } from "@/lib/project.server";
import { cn, shortDate } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/insights">): Promise<Metadata> {
  const { username, project } = await params;
  return { title: `Insights · ${(await getProject(username, project)).name}` };
}

export default async function InsightsPage({ params, searchParams }: PageProps<"/[username]/[project]/insights">) {
  const { username, project } = await params;
  const sp = await searchParams;
  const p = await getProject(username, project);
  requirePermission(p, "tasks.view");
  const window = sp.window === "90" ? "90" : "30";
  const base = `/${p.owner.username}/${p.slug}`;
  const d = await api<ProjectInsights>(`/projects/${p.owner.username}/${p.slug}/insights?window=${window}`);
  const t = d.tasks;
  const today = d.generatedAt.slice(0, 10);

  return (
    <PageBody>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Delivery insights</h2>
          <p className="text-sm text-muted">How work flows through {p.name}, computed from task and pull request history.</p>
        </div>
        <div className="inline-flex rounded-md border border-border bg-bg-subtle p-0.5" role="tablist" aria-label="Time window">
          {(["30", "90"] as const).map((w) => (
            <Link
              key={w}
              href={`${base}/insights?window=${w}`}
              scroll={false}
              role="tab"
              aria-selected={window === w}
              className={cn("transition-ui rounded-[5px] px-2.5 py-1 text-xs font-medium", window === w ? "bg-surface text-fg shadow-[0_0_0_1px_var(--border)]" : "text-muted hover:text-fg")}
            >
              Last {w} days
            </Link>
          ))}
        </div>
      </div>

      <section className="mb-8">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Completed" value={String(t.completed)} hint={`${t.created} created`} />
          <Stat label="Cycle time, median" value={formatDuration(t.cycleTime.p50)} hint={t.cycleTime.p85 != null ? `85% within ${formatDuration(t.cycleTime.p85)}` : "Start to done"} />
          <Stat label="Lead time, median" value={formatDuration(t.leadTime.p50)} hint="Created to done" />
          <Stat label="In progress" value={String(t.wip)} hint={t.aging.filter((a) => a.stale).length ? `${t.aging.filter((a) => a.stale).length} aging` : "Work in progress"} />
          <Stat label="Time to merge" value={formatDuration(d.pullRequests?.timeToMerge.p50 ?? null)} hint={d.pullRequests ? `${d.pullRequests.merged} merged` : "No repository"} />
          <Stat label="First review" value={formatDuration(d.pullRequests?.timeToFirstReview.p50 ?? null)} hint={d.pullRequests?.timeToFirstReview.count ? `across ${d.pullRequests.timeToFirstReview.count} PRs` : "No reviews yet"} />
        </dl>
      </section>

      {d.forecasts.length > 0 && (
        <section className="mb-8">
          <SectionHeader title="Milestone forecasts" />
          <p className="-mt-1 mb-3 text-xs text-muted">
            Simulated 5,000 times from the last 12 weeks of completed tasks. Ranges, not promises: the wider the band, the less steady the pace.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {d.forecasts.map((f) => {
              const prob = f.onTimeProbability;
              const tone = prob == null ? null : prob >= 0.8 ? "good" : prob >= 0.5 ? "warn" : "bad";
              return (
                <Panel key={f.milestone.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`${base}/tasks?milestone=${f.milestone.id}`} className="text-sm font-medium hover:underline">
                        {f.milestone.title}
                      </Link>
                      <p className="text-xs text-muted tnum">
                        {f.done} done · {f.remaining} remaining{f.milestone.dueOn && ` · due ${shortDate(f.milestone.dueOn)}`}
                      </p>
                    </div>
                    {tone && (
                      <Badge tone={tone === "good" ? "success" : tone === "warn" ? "warning" : "danger"}>
                        {tone === "good" ? <CircleCheck className="size-3" /> : tone === "warn" ? <AlertTriangle className="size-3" /> : <CircleX className="size-3" />}
                        {Math.round(prob! * 100)}% on time
                      </Badge>
                    )}
                  </div>
                  {f.reason ? (
                    <p className="mt-4 text-sm text-muted">
                      {f.reason === "done"
                        ? "Everything in this milestone is done."
                        : f.reason === "no_history"
                          ? "Not enough history yet. Forecasts start after three weeks of completed work."
                          : "No tasks were completed in the last 12 weeks, so there is no pace to project."}
                    </p>
                  ) : f.p50 && f.p85 && f.p95 ? (
                    <>
                      <p className="mt-3 text-sm">
                        Likely done by <span className="font-medium">{shortDate(f.p85)}</span>
                        <span className="text-muted"> (85% confidence), possibly as early as {shortDate(f.p50)}.</span>
                      </p>
                      <ForecastStrip today={today} p50={f.p50} p85={f.p85} p95={f.p95} due={f.milestone.dueOn} />
                    </>
                  ) : (
                    <p className="mt-4 text-sm text-muted">At the current pace this would take more than two years. Scope or pace needs to change.</p>
                  )}
                </Panel>
              );
            })}
          </div>
        </section>
      )}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader title="Tasks completed per week" />
          <Panel className="px-4 py-4">
            <ColumnChart data={t.throughput.map((w) => ({ x: w.weekStart, y: w.count }))} label="Tasks completed per week, last 12 weeks" unit="completed" />
          </Panel>
        </section>
        <section>
          <SectionHeader title={d.pullRequests ? "Pull requests merged per week" : "Pull requests"} />
          <Panel className="px-4 py-4">
            {d.pullRequests ? (
              <ColumnChart data={d.pullRequests.mergedPerWeek.map((w) => ({ x: w.weekStart, y: w.count }))} label="Pull requests merged per week, last 12 weeks" unit="merged" />
            ) : (
              <p className="py-12 text-center text-sm text-muted">Connect a repository to see pull request flow.</p>
            )}
          </Panel>
        </section>
      </div>

      <section className="mb-8">
        <SectionHeader title="Burn-up" />
        <Panel className="px-4 py-4">
          <BurnupChart data={d.burnup} />
        </Panel>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section>
          <SectionHeader title="Work in progress, oldest first" count={t.aging.length} />
          {t.aging.length === 0 ? (
            <Panel className="px-4 py-8 text-center text-sm text-muted">Nothing in progress.</Panel>
          ) : (
            <Panel className="divide-y divide-border">
              {t.aging.map((a) => (
                <Link key={a.number} href={`${base}/tasks?task=${a.number}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-surface-hover">
                  <StatusIcon status={a.status} />
                  <span className="w-16 shrink-0 font-mono text-xs text-faint">{a.identifier}</span>
                  <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  {a.stale && (
                    <span className="hidden items-center gap-1 text-2xs text-warning sm:flex" title="Open longer than 85% of recently completed tasks took">
                      <Clock className="size-3" /> Aging
                    </span>
                  )}
                  {a.assignee && <Avatar user={a.assignee} size={18} />}
                  <span className="w-12 shrink-0 text-right text-xs text-muted tnum">{a.ageDays}d</span>
                </Link>
              ))}
            </Panel>
          )}
        </section>

        <div className="space-y-6">
          <section>
            <SectionHeader title="By priority" />
            <Panel className="divide-y divide-border text-sm">
              {t.byPriority.map((b) => (
                <div key={b.priority} className="flex items-center gap-3 px-3 py-2">
                  <PriorityIcon priority={b.priority} />
                  <span className="flex-1">{PRIORITY_LABEL[b.priority]}</span>
                  <span className="w-20 text-right text-xs text-muted tnum">{b.completed} done</span>
                  <span className="w-16 text-right text-xs text-muted tnum">{b.p50CycleHours != null ? formatDuration(b.p50CycleHours) : ""}</span>
                </div>
              ))}
            </Panel>
            <p className="mt-1.5 text-2xs text-faint">Completed in the window, with median cycle time. If urgent work is not faster than the rest, priority is not doing its job.</p>
          </section>

          {d.contributors.length > 0 && (
            <section>
              <SectionHeader title="Contributors" />
              <Panel className="divide-y divide-border text-sm">
                <div className="flex gap-3 px-3 py-1.5 text-2xs text-faint">
                  <span className="flex-1">Member</span>
                  <span className="w-12 text-right">Tasks</span>
                  <span className="w-12 text-right">PRs</span>
                  <span className="w-14 text-right">Reviews</span>
                </div>
                {d.contributors.map((c) => (
                  <div key={c.user.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <Avatar user={c.user} size={18} />
                      <span className="truncate">{c.user.displayName}</span>
                    </span>
                    <span className="w-12 text-right text-xs tnum">{c.completed}</span>
                    <span className="w-12 text-right text-xs tnum">{c.prsMerged}</span>
                    <span className="w-14 text-right text-xs tnum">{c.reviews}</span>
                  </div>
                ))}
              </Panel>
            </section>
          )}
        </div>
      </div>
      <p className="mt-8 text-2xs text-faint">
        Updated {new Date(d.generatedAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}. Figures refresh within a minute of changes.
      </p>
    </PageBody>
  );
}
