/* eslint-disable @next/next/no-html-link-for-pages -- project pages are served by the workspace zone, not A's router. */
import { getProfileProjects } from "@/lib/workspace";
import { Card } from "@/components/ui";

interface WorkspaceProjectsProps {
  userId: string;
  username: string;
  viewerId?: string;
}

export async function WorkspaceProjects({ userId, username, viewerId }: WorkspaceProjectsProps) {
  const memberships = await getProfileProjects(userId, viewerId);
  if (!memberships.length && userId !== viewerId) return null;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-l font-bold">Building & shipping</h2>
        <a href={`/projects/${username}`} className="text-s font-medium text-brand hover:underline">
          Build history ↗
        </a>
      </div>
      {memberships.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {memberships.map(({ project, role }) => (
            <a
              key={project.id}
              href={`/projects/${project.owner.username}/${project.slug}`}
              className="group block rounded-large border border-border bg-body-bg p-4 transition-colors hover:border-brand"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate font-semibold group-hover:text-brand">{project.name}</h3>
                <span className="rounded bg-base-bg px-2 py-1 text-xs text-secondary">
                  {project.stage.toLowerCase()}
                </span>
              </div>
              {project.tagline && (
                <p className="mt-2 line-clamp-2 text-s text-secondary">{project.tagline}</p>
              )}
              <p className="mt-3 text-xs text-secondary">
                {role.toLowerCase()} · {project._count.members} members · {project._count.releases} releases
                {project.visibility !== "PUBLIC" ? " · private" : ""}
              </p>
            </a>
          ))}
        </div>
      ) : (
        <Card className="p-5">
          <p className="text-s text-secondary">Turn your next idea into a project.</p>
          <a href="/projects/new?blank=1" className="mt-2 inline-block text-s font-semibold text-brand hover:underline">
            Start building ↗
          </a>
        </Card>
      )}
    </section>
  );
}
