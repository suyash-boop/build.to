import type { Prisma } from "@bldt/db";
import type { Deps } from "../context.ts";
import { octokitForUser } from "./github-user.ts";
import { forbidden } from "./errors.ts";

/**
 * Confirm the user can access each GitHub repository through the bld.t app and upsert local
 * records. A user-to-server token can only read repos that the user can access AND the app is
 * installed on, so a successful read proves both.
 */
export async function verifyAndUpsertRepositories(deps: Deps, userId: string, githubIds: number[]) {
  const gh = await octokitForUser(deps, userId);
  const out: { id: string; githubId: bigint }[] = [];

  for (const githubId of githubIds) {
    let repo;
    try {
      ({ data: repo } = await gh.request("GET /repositories/{repository_id}", { repository_id: githubId }));
    } catch {
      throw forbidden(`Repository ${githubId} is not accessible. Install the bld.t GitHub App on it first.`);
    }
    // Reading a public repository proves nothing; connecting one to a project needs write access,
    // so nobody can attach someone else's repository (and its installation) to their own project.
    if (!repo.permissions?.push && !repo.permissions?.admin) {
      throw forbidden(`You need write access to ${repo.full_name} on GitHub to connect it.`);
    }
    let installation;
    try {
      ({ data: installation } = await deps.github.octokit.request("GET /repos/{owner}/{repo}/installation", { owner: repo.owner.login, repo: repo.name }));
    } catch {
      throw forbidden(`The bld.t GitHub App is not installed on ${repo.full_name}. Install it on that repository first.`);
    }

    await deps.db.githubInstallation.upsert({
      where: { id: BigInt(installation.id) },
      create: {
        id: BigInt(installation.id),
        accountLogin: installation.account && "login" in installation.account ? installation.account.login : repo.owner.login,
        accountId: BigInt(installation.account?.id ?? repo.owner.id),
        accountType: installation.target_type,
        repoSelection: installation.repository_selection,
      },
      update: { deletedAt: null },
    });

    const data = {
      installationId: BigInt(installation.id),
      ownerLogin: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      htmlUrl: repo.html_url,
      homepageUrl: repo.homepage || null,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      isFork: repo.fork,
      isArchived: repo.archived,
      primaryLanguage: repo.language ?? null,
      topics: repo.topics ?? [],
      stars: repo.stargazers_count,
      pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
    } satisfies Prisma.RepositoryUncheckedUpdateInput;

    const row = await deps.db.repository.upsert({
      where: { githubId: BigInt(repo.id) },
      create: { githubId: BigInt(repo.id), ...data },
      update: data,
      select: { id: true, githubId: true },
    });
    out.push(row);
  }
  return out;
}
