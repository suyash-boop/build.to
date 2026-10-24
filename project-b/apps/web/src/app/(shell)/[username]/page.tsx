import type { ActivityItem, BuildHistoryEntry, Paginated, ProfileProject, PublicProfile } from "@bldt/contracts";
import { CalendarDays, Globe, Lock, MapPin, Rocket, Sparkle, Tag, UserPlus, Sunset } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActivityFeed } from "@/components/domain/activity";
import { GithubMark } from "@/components/domain/logo";
import { StageBadge, TechChip, TrustMark } from "@/components/domain/status";
import { PageBody } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, EmptyState, Panel, SectionHeader } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/overlay";
import { api, apiOr404 } from "@/lib/api.server";
import { compactNumber, monthYear, plural, shortDate } from "@/lib/utils";
import { cache } from "react";

const getProfile = cache((u: string) => apiOr404<PublicProfile>(`/users/${encodeURIComponent(u)}`));

export async function generateMetadata({ params }: PageProps<"/[username]">): Promise<Metadata> {
  const { username } = await params;
  const p = await getProfile(username);
  return {
    title: `${p.displayName} (@${p.username})`,
    description: p.headline ?? `${p.displayName} on bld.t: ${plural(p.summary.shipped, "shipped project")}.`,
  };
}

export default async function ProfilePage({ params }: PageProps<"/[username]">) {
  const { username } = await params;
  // Fetch both at once. The profile is awaited first so a missing user still 404s; the
  // no-op catch keeps an activity failure from going unhandled while that happens.
  const activityP = api<Paginated<ActivityItem>>(`/users/${encodeURIComponent(username)}/activity?limit=15`);
  activityP.catch(() => {});
  const p = await getProfile(username);
  const activity = await activityP;

  const stats: [string, number][] = [
    ["Shipped", p.summary.shipped],
    ["Building", p.summary.building],
    ["Collaborators", p.summary.collaborators],
    ["PRs merged", p.summary.mergedPrs],
    ["Reviews", p.summary.reviews],
  ];

  return (
    <PageBody>
      <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm"><span className="text-muted">The work behind the profile.</span><a href={`/${username}`} className="font-medium text-primary hover:underline">Community profile & articles ↗</a></div>
      <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Avatar user={p} size={72} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{p.displayName}</h1>
          <p className="text-sm text-faint">@{p.username}</p>
          {p.headline && <p className="mt-3 text-sm font-medium">{p.headline}</p>}
          {p.openToWork && (
            <p className="mt-3">
              <Badge tone="success">Open to work</Badge>
            </p>
          )}
          {p.bio && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted">{p.bio}</p>}
          <ul className="mt-4 space-y-1.5 text-sm text-muted">
            {p.location && (
              <li className="flex items-center gap-2"><MapPin className="size-3.5 text-faint" /> {p.location}</li>
            )}
            {p.websiteUrl && (
              <li className="flex items-center gap-2">
                <Globe className="size-3.5 text-faint" />
                <a href={p.websiteUrl} target="_blank" rel="noopener noreferrer me" className="truncate hover:text-fg hover:underline">
                  {p.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              </li>
            )}
            {p.githubLogin && (
              <li className="flex items-center gap-2">
                <GithubMark className="size-3.5 text-faint" />
                <a href={`https://github.com/${p.githubLogin}`} target="_blank" rel="noopener noreferrer me" className="hover:text-fg hover:underline">
                  {p.githubLogin}
                </a>
                <TrustMark trust="CONNECTED" />
              </li>
            )}
            <li className="flex items-center gap-2"><CalendarDays className="size-3.5 text-faint" /> Joined {monthYear(p.joinedAt)}</li>
          </ul>
          {p.focusAreas.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1">
              {p.focusAreas.map((f) => (
                <span key={f} className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted">{f}</span>
              ))}
            </div>
          )}
          {p.isSelf && (
            <Button asChild size="sm" className="mt-5 w-full justify-center">
              <Link href="/settings">Edit profile</Link>
            </Button>
          )}
        </aside>

        <div className="min-w-0 space-y-10">
          <section>
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
              {stats.map(([label, value]) => (
                <div key={label} className="bg-surface px-4 py-3">
                  <dt className="text-2xs text-faint">{label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tnum">{compactNumber(value)}</dd>
                </div>
              ))}
            </dl>
            {p.summary.privateProjects > 0 && (
              <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
                <Lock className="size-3 text-faint" />
                Also works on {plural(p.summary.privateProjects, "private project")}
                {p.summary.privateMergedPrs > 0 && <> with {plural(p.summary.privateMergedPrs, "merged pull request")}</>}. Names and details are not shown.
              </p>
            )}
          </section>

          {p.technologies.length > 0 && (
            <section>
              <SectionHeader title="Stack" />
              <div className="flex flex-wrap gap-1.5">
                {p.technologies.slice(0, 24).map((t) => (
                  <Tooltip
                    key={t.slug}
                    content={
                      <>
                        Used in {plural(t.projects, "project")} here.{" "}
                        {t.evidenced ? "Backed by their own commits or merged PRs." : "No GitHub contribution evidence yet."}
                      </>
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      <TechChip tech={t} className={t.evidenced ? "border-border-strong text-fg" : ""} />
                    </span>
                  </Tooltip>
                ))}
              </div>
              <p className="mt-2 text-xs text-faint">Darker chips are backed by this person&apos;s own commits or merged pull requests.</p>
            </section>
          )}

          <section>
            <SectionHeader title="Projects" count={p.projects.length} />
            {p.projects.length === 0 ? (
              <EmptyState title={p.isSelf ? "Your public projects will show here" : "No public projects yet"} action={p.isSelf ? <Button asChild size="sm" variant="primary"><Link href="/new">Start a project</Link></Button> : undefined}>
                {p.isSelf ? "Projects you make public, and projects you join, appear on your profile. You can hide any of them." : undefined}
              </EmptyState>
            ) : (
              <div className="space-y-3">
                {p.projects.map((proj) => (
                  <ProjectRow key={proj.id} p={proj} isSelf={p.isSelf} />
                ))}
              </div>
            )}
          </section>

          {p.history.length > 0 && (
            <section>
              <SectionHeader title="Build history" />
              <History entries={p.history} />
            </section>
          )}

          <section>
            <SectionHeader title="Recent activity" />
            <Panel className="px-4 py-2">
              <ActivityFeed items={activity.items} showProject byDay emptyText="No public activity yet." />
            </Panel>
          </section>
        </div>
      </div>
    </PageBody>
  );
}

function ProjectRow({ p, isSelf }: { p: ProfileProject; isSelf: boolean }) {
  const c = p.contribution;
  return (
    <Link href={`/${p.owner.username}/${p.slug}`} className="block rounded-lg border border-border bg-surface px-4 py-3.5 transition-colors hover:border-border-strong">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{p.name}</span>
            <StageBadge stage={p.stage} />
            {isSelf && p.visibility !== "PUBLIC" && (
              <span className="inline-flex items-center gap-1 text-2xs text-faint">
                <Lock className="size-3" /> {p.visibility === "PRIVATE" ? "Private, only you see this here" : "Unlisted, only you see this here"}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-faint">
            {p.title ?? roleWord(p.role)} · {p.owner.username}/{p.slug}
          </p>
        </div>
        <span className="text-xs text-faint tnum">{p.shippedAt ? `Shipped ${shortDate(p.shippedAt)}` : `Updated ${shortDate(p.updatedAt)}`}</span>
      </div>
      {p.tagline && <p className="mt-2 text-sm text-muted">{p.tagline}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex flex-wrap gap-1">
          {p.technologies.slice(0, 5).map((t) => (
            <TechChip key={t.slug} tech={t} />
          ))}
        </div>
        {c && (c.commits > 0 || c.prsMerged > 0) && (
          <span className="flex items-center gap-1.5 text-xs text-muted tnum">
            <TrustMark trust="CONNECTED" />
            {compactNumber(c.commits)} commits · {c.prsMerged} PRs merged
            {c.reviews > 0 && <> · {c.reviews} reviews</>}
          </span>
        )}
        {p.releases > 0 && <span className="text-xs text-muted tnum">{plural(p.releases, "release")}</span>}
      </div>
    </Link>
  );
}

function roleWord(role: ProfileProject["role"]) {
  return { OWNER: "Owner", MAINTAINER: "Maintainer", CONTRIBUTOR: "Contributor", VIEWER: "Member" }[role];
}

const HISTORY_ICON = {
  shipped: <Rocket className="size-3.5 text-st-shipped" />,
  release: <Tag className="size-3.5" />,
  joined: <UserPlus className="size-3.5" />,
  started: <Sparkle className="size-3.5" />,
  sunset: <Sunset className="size-3.5" />,
} as const;

function History({ entries }: { entries: BuildHistoryEntry[] }) {
  const byYear = new Map<string, BuildHistoryEntry[]>();
  for (const e of entries) {
    const y = e.occurredAt.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), e]);
  }
  return (
    <div className="space-y-6">
      {[...byYear.entries()].map(([year, items]) => (
        <div key={year} className="grid gap-3 sm:grid-cols-[56px_minmax(0,1fr)]">
          <p className="pt-2 text-sm font-medium text-faint tnum">{year}</p>
          <ol className="relative">
            {items.map((e, i) => (
              <li key={e.id} className="relative flex gap-3 py-2">
                {i < items.length - 1 && <span className="absolute left-[9px] top-7 bottom-[-6px] w-px bg-border" aria-hidden />}
                <span className="relative z-10 flex size-[19px] shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted">
                  {HISTORY_ICON[e.kind]}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    {e.kind === "shipped" ? (
                      <>
                        Shipped <Link href={`/${e.project.ownerUsername}/${e.project.slug}`} className="font-medium hover:underline">{e.project.name}</Link>
                        <span className="text-muted">: {e.title}</span>
                      </>
                    ) : e.kind === "release" ? (
                      <>
                        Released <span className="font-medium">{e.title}</span> in{" "}
                        <Link href={`/${e.project.ownerUsername}/${e.project.slug}`} className="hover:underline">{e.project.name}</Link>
                      </>
                    ) : (
                      <>
                        {e.kind === "started" ? "Started" : e.kind === "joined" ? "Joined" : "Wound down"}{" "}
                        <Link href={`/${e.project.ownerUsername}/${e.project.slug}`} className="font-medium hover:underline">{e.project.name}</Link>
                      </>
                    )}
                    {e.version && <span className="ml-1.5 font-mono text-xs text-faint">{e.version}</span>}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-faint tnum">
                  <TrustMark trust={e.trust} />
                  {shortDate(e.occurredAt)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
