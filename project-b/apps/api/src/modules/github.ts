import type { GithubInstallationItem, ImportableRepository } from "@bldt/contracts";
import { installUrl } from "@bldt/github";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireViewer } from "../plugins/auth.ts";
import { octokitForUser } from "../lib/github-user.ts";
import { notFound } from "../lib/errors.ts";

export const githubRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env } = app.deps;

  app.get("/github/install-url", async (req) => {
    requireViewer(req);
    return { url: installUrl(env.GITHUB_APP_SLUG) };
  });

  /** Installations of the bld.t GitHub App this user can access (their account and orgs). */
  app.get("/github/installations", async (req) => {
    const viewer = requireViewer(req);
    const gh = await octokitForUser(app.deps, viewer.id);
    const { data } = await gh.rest.apps.listInstallationsForAuthenticatedUser({ per_page: 100 });

    const items: GithubInstallationItem[] = [];
    for (const inst of data.installations) {
      const account = inst.account as { login?: string; slug?: string; id: number } | null;
      const login = account?.login ?? account?.slug;
      // No account, no record: never store an invented owner.
      if (!account?.id || !login) continue;
      await db.githubInstallation.upsert({
        where: { id: BigInt(inst.id) },
        create: {
          id: BigInt(inst.id),
          accountLogin: login,
          accountId: BigInt(account.id),
          accountType: inst.target_type,
          repoSelection: inst.repository_selection,
          suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null,
        },
        update: {
          accountLogin: login,
          repoSelection: inst.repository_selection,
          suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null,
          deletedAt: null,
        },
      });
      items.push({
        id: inst.id,
        accountLogin: login,
        accountType: inst.target_type,
        repoSelection: inst.repository_selection,
        manageUrl: inst.html_url,
      });
    }
    return { items, installUrl: installUrl(env.GITHUB_APP_SLUG) };
  });

  /** Repositories the user can import through one installation. */
  app.get(
    "/github/installations/:installationId/repositories",
    { schema: { params: z.object({ installationId: z.coerce.number().int().positive() }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const gh = await octokitForUser(app.deps, viewer.id);

      let repos;
      try {
        repos = await gh.paginate(gh.rest.apps.listInstallationReposForAuthenticatedUser, {
          installation_id: req.params.installationId,
          per_page: 100,
        });
      } catch (err) {
        if ((err as { status?: number }).status === 404) throw notFound("Installation not found");
        throw err;
      }

      const ids = repos.map((r) => BigInt(r.id));
      const connected = await db.repository.findMany({
        where: { githubId: { in: ids } },
        select: {
          githubId: true,
          projects: {
            where: { project: { deletedAt: null, members: { some: { userId: viewer.id } } } },
            select: { project: { select: { name: true, slug: true, owner: { select: { username: true } } } } },
            take: 1,
          },
        },
      });
      const connectedMap = new Map(connected.map((c) => [c.githubId.toString(), c.projects[0]?.project ?? null]));

      const items: ImportableRepository[] = repos
        .map((r) => {
          const p = connectedMap.get(String(r.id));
          return {
            githubId: r.id,
            fullName: r.full_name,
            name: r.name,
            description: r.description,
            isPrivate: r.private,
            isFork: r.fork,
            isArchived: r.archived ?? false,
            primaryLanguage: r.language ?? null,
            stars: r.stargazers_count ?? 0,
            pushedAt: r.pushed_at ?? null,
            installationId: req.params.installationId,
            connectedTo: p ? { name: p.name, slug: p.slug, ownerUsername: p.owner.username } : null,
          };
        })
        .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
      return { items };
    },
  );
};
