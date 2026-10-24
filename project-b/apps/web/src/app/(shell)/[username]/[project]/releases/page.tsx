import type { ChangelogDto, DeploymentSummary, ReleaseItem } from "@bldt/contracts";
import { ExternalLink, Rocket, Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GithubMark } from "@/components/domain/logo";
import { Markdown } from "@/components/domain/markdown";
import { TrustMark } from "@/components/domain/status";
import { RelativeTime } from "@/components/domain/time";
import { PageBody } from "@/components/shell/page";
import { Avatar, Badge, EmptyState, Panel, SectionHeader } from "@/components/ui/misc";
import { api } from "@/lib/api.server";
import { can, getProject } from "@/lib/project.server";
import { cn, isHttpUrl, shortDate } from "@/lib/utils";
import { ReleaseChanges, UnreleasedChanges } from "./changelog";

export async function generateMetadata({ params }: PageProps<"/[username]/[project]/releases">): Promise<Metadata> {
  const { username, project } = await params;
  return { title: `Releases · ${(await getProject(username, project)).name}` };
}

const SOURCE: Record<ReleaseItem["source"], string> = {
  MANUAL: "Recorded on bld.t",
  GITHUB_RELEASE: "GitHub release",
  DEPLOYMENT: "Deployment",
};

export default async function ReleasesPage({ params }: PageProps<"/[username]/[project]/releases">) {
  const { username, project } = await params;
  const p = await getProject(username, project);
  const base = `/projects/${p.owner.username}/${p.slug}`;
  const [{ releases, deployments }, unreleased] = await Promise.all([
    api<{ releases: ReleaseItem[]; deployments: DeploymentSummary[] }>(`${base}/releases`),
    // Supplementary: the page still renders if the changelog cannot be built.
    api<ChangelogDto>(`${base}/changelog`).catch(() => null),
  ]);
  const hasRepos = p.repositories.length > 0;

  return (
    <PageBody>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          {unreleased && unreleased.sections.length > 0 && (
            <div className="mb-8">
              <SectionHeader title="Unreleased" />
              <Panel>
                <UnreleasedChanges changelog={unreleased} />
              </Panel>
            </div>
          )}
          <SectionHeader title="Releases" count={releases.length} />
          {releases.length === 0 ? (
            <EmptyState icon={<Rocket className="size-5" />} title="Nothing shipped yet">
              {can(p, "project.ship")
                ? "Use Ship at the top of the page, or publish a release on GitHub. Releases on connected repositories are recorded automatically."
                : "When the team ships, releases appear here."}
            </EmptyState>
          ) : (
            <ol className="space-y-4">
              {releases.map((r) => (
                <li key={r.id}>
                  <Panel className={cn("overflow-hidden", r.isShip && "border-st-shipped/40")}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
                      {r.isShip ? <Rocket className="size-4 text-st-shipped" /> : <Tag className="size-4 text-muted" />}
                      <h3 className="text-sm font-medium">{r.title}</h3>
                      {r.version && <span className="font-mono text-xs text-muted">{r.version}</span>}
                      {r.isShip && <Badge tone="success">Launch</Badge>}
                      <span className="ml-auto flex items-center gap-2 text-xs text-faint">
                        <TrustMark trust={r.source === "MANUAL" ? "PLATFORM" : "CONNECTED"} />
                        {SOURCE[r.source]} · <time dateTime={r.shippedAt}>{shortDate(r.shippedAt)}</time>
                      </span>
                    </div>
                    {(r.notes || r.url || r.createdBy) && (
                      <div className="px-4 py-3">
                        {r.notes && <Markdown className="text-sm">{r.notes}</Markdown>}
                        <div className={cn("flex flex-wrap items-center gap-4 text-xs text-muted", r.notes && "mt-3")}>
                          {r.createdBy && (
                            <Link href={`/${r.createdBy.username}`} className="flex items-center gap-1.5 hover:text-fg">
                              <Avatar user={r.createdBy} size={16} /> {r.createdBy.displayName}
                            </Link>
                          )}
                          {isHttpUrl(r.url) && (
                            <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-fg">
                              {r.source === "GITHUB_RELEASE" ? <GithubMark className="size-3" /> : <ExternalLink className="size-3" />}
                              {r.source === "GITHUB_RELEASE" ? "View on GitHub" : new URL(r.url).host}
                            </a>
                          )}
                          {r.commitSha && <span className="font-mono text-faint">{r.commitSha.slice(0, 7)}</span>}
                        </div>
                      </div>
                    )}
                    {hasRepos && <ReleaseChanges api={base} releaseId={r.id} />}
                  </Panel>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="min-w-0">
          <SectionHeader title="Deployments" count={deployments.length} />
          {deployments.length === 0 ? (
            <Panel className="px-4 py-6 text-sm text-muted">
              Deployments reported through the GitHub Deployments API show up here with their status. Vercel, Netlify, and GitHub Actions environments report there automatically.
            </Panel>
          ) : (
            <Panel className="divide-y divide-border">
              {deployments.map((d) => (
                <div key={d.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      d.state === "SUCCESS" ? "bg-success" : d.state === "FAILURE" || d.state === "ERROR" ? "bg-danger" : d.state === "INACTIVE" ? "bg-faint" : "bg-warning",
                    )}
                    title={d.state.toLowerCase().replace("_", " ")}
                  />
                  <div className="min-w-0 flex-1">
                    {isHttpUrl(d.url) ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="block truncate hover:underline">{d.environment}</a>
                    ) : (
                      <span className="block truncate">{d.environment}</span>
                    )}
                    <span className="block truncate font-mono text-2xs text-faint">{d.sha.slice(0, 7)} · {d.ref}</span>
                  </div>
                  <RelativeTime iso={d.updatedAt} className="shrink-0 text-xs text-faint" />
                </div>
              ))}
            </Panel>
          )}
        </aside>
      </div>
    </PageBody>
  );
}
