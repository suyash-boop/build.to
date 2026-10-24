import { ExternalLink, Globe, Link2, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { GithubMark } from "@/components/domain/logo";
import { StageBadge } from "@/components/domain/status";
import { Tooltip } from "@/components/ui/overlay";
import { getMe } from "@/lib/api.server";
import { can, getProject } from "@/lib/project.server";
import { ProjectActions } from "./project-actions";
import { ProjectTabs } from "./project-tabs";

export async function generateMetadata({ params }: LayoutProps<"/[username]/[project]">): Promise<Metadata> {
  const { username, project } = await params;
  const p = await getProject(username, project);
  return {
    title: p.name,
    description: p.tagline ?? undefined,
    // Unlisted and private projects must never be indexed.
    robots: p.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
    openGraph: { title: p.name, description: p.tagline ?? undefined },
  };
}

export default async function ProjectLayout({ params, children }: LayoutProps<"/[username]/[project]">) {
  const { username, project } = await params;
  const [p, me] = await Promise.all([getProject(username, project), getMe()]);
  const base = `/${p.owner.username}/${p.slug}`;
  const primaryRepo = p.repositories.find((r) => r.isPrimary) ?? p.repositories[0];
  const isMember = p.viewer.role !== null;

  const tabs = [
    { href: base, label: "Overview", exact: true },
    ...(can(p, "tasks.view") ? [{ href: `${base}/tasks`, label: "Tasks" }, { href: `${base}/discussions`, label: "Discussions" }, { href: `${base}/milestones`, label: "Milestones" }, { href: `${base}/insights`, label: "Insights" }] : []),
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/releases`, label: "Releases" },
    { href: `${base}/people`, label: "People" },
    ...(can(p, "project.update") ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];

  const VisIcon = p.visibility === "PUBLIC" ? Globe : p.visibility === "UNLISTED" ? Link2 : Lock;
  const visLabel = {
    PUBLIC: "Public: listed in discovery",
    UNLISTED: "Unlisted: anyone with the link",
    PRIVATE: "Private: members only",
  }[p.visibility];

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 md:px-6 md:pt-5">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-faint">
                <Link href={`/${p.owner.username}`} className="hover:text-fg">
                  {p.owner.username}
                </Link>
                <span>/</span>
                <span className="font-mono">{p.key}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
                <StageBadge stage={p.stage} />
                {isMember && (
                  <Tooltip content={visLabel}>
                    <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-border px-1.5 text-2xs text-muted">
                      <VisIcon className="size-3" />
                      {p.visibility.charAt(0) + p.visibility.slice(1).toLowerCase()}
                    </span>
                  </Tooltip>
                )}
              </div>
              {p.tagline && <p className="mt-1.5 max-w-2xl text-sm text-muted">{p.tagline}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {p.homepageUrl && (
                <a
                  href={p.homepageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-surface-hover hover:text-fg"
                >
                  {new URL(p.homepageUrl).host} <ExternalLink className="size-3" />
                </a>
              )}
              {primaryRepo && (
                <a
                  href={primaryRepo.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-surface-hover hover:text-fg"
                >
                  <GithubMark className="size-3.5" />
                  <span className="hidden sm:inline">{primaryRepo.fullName}</span>
                </a>
              )}
              <ProjectActions project={p} signedIn={Boolean(me)} aiEnabled={Boolean(me?.features.ai)} />
            </div>
          </div>
          <ProjectTabs tabs={tabs} />
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
