import { detectStack, isManifestPath, type Octokit } from "@bldt/github";
import type { Prisma } from "@bldt/db";
import { installationOctokit, PermanentError, type WorkerDeps } from "../context.ts";
import { mirrorDeployment, mirrorIssue, mirrorPullRequest, mirrorRelease, projectsForRepo, refreshPrCounts, type GhIssue, type GhPull } from "../mirror.ts";

const MAX_PR_PAGES = 5;
const MAX_ISSUE_PAGES = 5;
const MAX_MANIFESTS = 25;
const MAX_README_BYTES = 200_000;
const FEED_BACKFILL_DAYS = 90;

/** Full repository sync. Idempotent; safe to run any time. */
export async function syncRepository(deps: WorkerDeps, repositoryId: string) {
  const { db, log } = deps;
  const repo = await db.repository.findUnique({ where: { id: repositoryId } });
  if (!repo) return;
  if ((await projectsForRepo(deps, repo.id)).length === 0) {
    log.info({ repo: repo.fullName }, "skipping sync: repository not linked to any project");
    return;
  }
  if (!repo.installationId) {
    await db.repository.update({
      where: { id: repo.id },
      data: { syncStatus: "FAILED", syncError: "The bld.t GitHub App no longer has access to this repository." },
    });
    return;
  }

  await db.repository.update({ where: { id: repo.id }, data: { syncStatus: "SYNCING", syncError: null } });

  try {
    const gh = await installationOctokit(deps, repo.installationId);
    const [owner, name] = [repo.ownerLogin, repo.name];

    // Look up by id: survives renames and transfers.
    let meta;
    try {
      ({ data: meta } = await gh.request("GET /repositories/{repository_id}", { repository_id: Number(repo.githubId) }));
    } catch (err) {
      if ((err as { status?: number }).status === 404) throw new PermanentError("Repository not found or access was removed.");
      throw err;
    }
    const [languages, readme] = await Promise.all([
      gh.rest.repos.listLanguages({ owner: meta.owner.login, repo: meta.name }).then((r) => r.data),
      fetchReadme(gh, meta.owner.login, meta.name),
    ]);
    const stack = await detectRepoStack(gh, meta.owner.login, meta.name, meta.default_branch).catch((err) => {
      log.warn({ err, repo: repo.fullName }, "stack detection failed");
      return null;
    });

    await db.repository.update({
      where: { id: repo.id },
      data: {
        ownerLogin: meta.owner.login,
        name: meta.name,
        fullName: meta.full_name,
        description: meta.description,
        htmlUrl: meta.html_url,
        homepageUrl: meta.homepage || null,
        defaultBranch: meta.default_branch,
        isPrivate: meta.private,
        isFork: meta.fork,
        isArchived: meta.archived,
        primaryLanguage: meta.language ?? null,
        topics: meta.topics ?? [],
        stars: meta.stargazers_count,
        pushedAt: meta.pushed_at ? new Date(meta.pushed_at) : null,
        languages: languages as Prisma.InputJsonValue,
        readme,
        ...(stack ? { detectedStack: stack as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    const current = { id: repo.id, fullName: meta.full_name };

    // Pull requests, most recently updated first.
    const cutoff = Date.now() - FEED_BACKFILL_DAYS * 24 * 3600 * 1000;
    const authors = new Map<string, bigint | null>();
    let pageNo = 0;
    for await (const { data } of gh.paginate.iterator(gh.rest.pulls.list, {
      owner: meta.owner.login,
      repo: meta.name,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    })) {
      for (const pr of data as unknown as GhPull[]) {
        const recent = new Date(pr.created_at).getTime() > cutoff || (pr.merged_at && new Date(pr.merged_at).getTime() > cutoff);
        await mirrorPullRequest(deps, current, pr, { recordEvents: Boolean(recent) });
        if (pr.user) authors.set(pr.user.login, BigInt(pr.user.id));
      }
      if (++pageNo >= MAX_PR_PAGES) break;
    }
    for (const [login, id] of authors) await refreshPrCounts(deps, repo.id, login, id);

    await syncIssues(deps, gh, current, meta.owner.login, meta.name, cutoff);

    // Releases, oldest first so the first published release is the one that marks the launch.
    const { data: releases } = await gh.rest.repos.listReleases({ owner: meta.owner.login, repo: meta.name, per_page: 100 });
    const ordered = [...releases].sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""));
    for (const rel of ordered) await mirrorRelease(deps, current, rel);

    // Recent deployments with their latest status.
    const { data: deployments } = await gh.rest.repos.listDeployments({ owner: meta.owner.login, repo: meta.name, per_page: 30 });
    for (const d of deployments) {
      const { data: statuses } = await gh.rest.repos.listDeploymentStatuses({
        owner: meta.owner.login,
        repo: meta.name,
        deployment_id: d.id,
        per_page: 1,
      });
      await mirrorDeployment(deps, current, d, statuses[0] ?? null);
    }

    await db.repository.update({
      where: { id: repo.id },
      data: { syncStatus: "IDLE", syncError: null, lastSyncedAt: new Date() },
    });

    await deps.jobs.enqueue("repo.contributors", { repositoryId: repo.id, attempt: 0 }, { dedupeId: repo.id });
    for (const projectId of await projectsForRepo(deps, repo.id)) {
      await deps.jobs.enqueue("project.recompute", { projectId }, { dedupeId: projectId });
    }
    log.info({ repo: meta.full_name, owner, name }, "repository synced");
  } catch (err) {
    const permanent = err instanceof PermanentError;
    await db.repository.update({
      where: { id: repo.id },
      data: {
        syncStatus: "FAILED",
        syncError: permanent ? err.message : "Sync failed. It will retry automatically.",
      },
    });
    if (permanent) {
      log.warn({ repo: repo.fullName, reason: err.message }, "permanent sync failure");
      return;
    }
    throw err;
  }
}

/**
 * Open issues, and issues closed within the backfill window, become tasks. A 403 means the
 * installation has not granted Issues access yet: skip quietly, everything else still syncs.
 */
async function syncIssues(deps: WorkerDeps, gh: Octokit, repo: { id: string; fullName: string }, owner: string, name: string, cutoff: number) {
  let pageNo = 0;
  try {
    for await (const { data } of gh.paginate.iterator(gh.rest.issues.listForRepo, { owner, repo: name, state: "all", sort: "updated", direction: "desc", per_page: 100 })) {
      for (const issue of data as unknown as GhIssue[]) {
        if (issue.pull_request) continue;
        const closedLongAgo = issue.state === "closed" && issue.closed_at && new Date(issue.closed_at).getTime() < cutoff;
        if (closedLongAgo) continue;
        await mirrorIssue(deps, repo, issue);
      }
      if (++pageNo >= MAX_ISSUE_PAGES) break;
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 403 || status === 404 || status === 410) {
      deps.log.info({ repo: repo.fullName, status }, "issues not available (permission not granted or issues disabled)");
      return;
    }
    throw err;
  }
}

async function fetchReadme(gh: Octokit, owner: string, repo: string): Promise<string | null> {
  try {
    const res = await gh.request("GET /repos/{owner}/{repo}/readme", {
      owner,
      repo,
      headers: { accept: "application/vnd.github.raw+json" },
    });
    const text = typeof res.data === "string" ? res.data : String(res.data);
    return text.length > MAX_README_BYTES ? text.slice(0, MAX_README_BYTES) : text;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

async function detectRepoStack(gh: Octokit, owner: string, repo: string, branch: string) {
  const { data: tree } = await gh.rest.git.getTree({ owner, repo, tree_sha: branch, recursive: "1" });
  const paths = tree.tree
    .filter((e) => e.type === "blob" && e.path && isManifestPath(e.path))
    .map((e) => e.path as string)
    .sort((a, b) => a.split("/").length - b.split("/").length)
    .slice(0, MAX_MANIFESTS);

  const files = await Promise.all(
    paths.map(async (path) => {
      try {
        const res = await gh.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner,
          repo,
          path,
          ref: branch,
          headers: { accept: "application/vnd.github.raw+json" },
        });
        return { path, content: typeof res.data === "string" ? res.data : JSON.stringify(res.data) };
      } catch {
        return null;
      }
    }),
  );
  return detectStack(files.filter((f): f is { path: string; content: string } => f !== null));
}

/** Per-author commit stats. GitHub answers 202 while computing; retry with backoff. */
export async function syncContributors(deps: WorkerDeps, repositoryId: string, attempt: number) {
  const { db } = deps;
  const repo = await db.repository.findUnique({ where: { id: repositoryId } });
  if (!repo?.installationId) return;
  const gh = await installationOctokit(deps, repo.installationId);

  const res = await gh.request("GET /repos/{owner}/{repo}/stats/contributors", { owner: repo.ownerLogin, repo: repo.name });
  if (res.status === 202 || !Array.isArray(res.data)) {
    if (attempt < 6) {
      await deps.jobs.enqueue("repo.contributors", { repositoryId, attempt: attempt + 1 }, { delayMs: 15_000 * 2 ** attempt });
    }
    return;
  }

  const projectIds = await projectsForRepo(deps, repo.id);
  for (const s of res.data as { author: { login: string; id: number } | null; total: number; weeks: { w: number; a: number; d: number; c: number }[] }[]) {
    if (!s.author) continue;
    const active = s.weeks.filter((w) => w.c > 0);
    const firstAt = active[0] ? new Date(active[0].w * 1000) : null;
    const lastAt = active.at(-1) ? new Date(active.at(-1)!.w * 1000) : null;
    const additions = s.weeks.reduce((a, w) => a + w.a, 0);
    const deletions = s.weeks.reduce((a, w) => a + w.d, 0);
    const data = { commits: s.total, additions, deletions, firstAt, lastAt, githubUserId: BigInt(s.author.id) };
    for (const projectId of projectIds) {
      await db.contribution.upsert({
        where: { projectId_repositoryId_githubLogin: { projectId, repositoryId, githubLogin: s.author.login } },
        create: { projectId, repositoryId, githubLogin: s.author.login, ...data },
        update: data,
      });
    }
  }
  for (const projectId of projectIds) await deps.jobs.enqueue("project.recompute", { projectId }, { dedupeId: projectId });
}

/** Scheduled safety net: webhooks can be missed during outages. */
export async function refreshStaleRepositories(deps: WorkerDeps) {
  const stale = await deps.db.repository.findMany({
    where: {
      installationId: { not: null },
      projects: { some: { project: { deletedAt: null } } },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - 12 * 3600 * 1000) } }],
      // A sync still "SYNCING" after an hour died with its worker; it is due again.
      AND: [{ OR: [{ syncStatus: { not: "SYNCING" } }, { updatedAt: { lt: new Date(Date.now() - 3600 * 1000) } }] }],
    },
    select: { id: true },
    // Never-synced first, then the longest waiting, so a backlog over the cap still drains in order.
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: 500,
  });
  for (const r of stale) await deps.jobs.enqueue("repo.sync", { repositoryId: r.id, reason: "scheduled" }, { dedupeId: r.id });
  deps.log.info({ count: stale.length }, "queued stale repository syncs");
}
