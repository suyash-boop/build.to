import { recordActivity } from "@bldt/core";
import type { WorkerDeps } from "../context.ts";
import { mirrorDeployment, mirrorIssue, mirrorPullRequest, mirrorRelease, projectsForRepo, refreshPrCounts, type GhIssue, type GhPull, type GhRelease } from "../mirror.ts";

type Payload = Record<string, any>;

/** Debounce: a burst of pushes produces one sync a minute later. */
const PUSH_SYNC_DELAY_MS = 60_000;
/** Short delay so a burst of events (open PR, push, review) produces one signals scan. */
const SIGNAL_SCAN_DELAY_MS = 15_000;

export async function processWebhook(deps: WorkerDeps, deliveryId: string, event: string, payload: Payload) {
  const { db } = deps;
  await db.webhookDelivery.update({ where: { id: deliveryId }, data: { attempts: { increment: 1 } } }).catch(() => {});

  try {
    const outcome = await route(deps, event, payload);
    // GitHub activity can open or close signals (review waiting, deploy failing, PR links).
    if (outcome === "processed" && (["pull_request", "pull_request_review", "deployment_status", "push"] as string[]).includes(event)) {
      const repoGithubId = (payload as { repository?: { id?: number } }).repository?.id;
      if (repoGithubId) {
        const links = await db.projectRepository.findMany({ where: { repository: { githubId: BigInt(repoGithubId) } }, select: { projectId: true } });
        for (const l of links) await deps.jobs.enqueue("signals.scan", { projectId: l.projectId }, { dedupeId: l.projectId, delayMs: SIGNAL_SCAN_DELAY_MS });
      }
    }
    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: outcome === "ignored" ? "IGNORED" : "PROCESSED", processedAt: new Date(), error: null },
    });
  } catch (err) {
    await db.webhookDelivery
      .update({ where: { id: deliveryId }, data: { status: "FAILED", error: String((err as Error).message).slice(0, 500) } })
      .catch(() => {});
    throw err;
  }
}

async function route(deps: WorkerDeps, event: string, p: Payload): Promise<"processed" | "ignored"> {
  switch (event) {
    case "ping":
      return "processed";
    case "installation":
      return onInstallation(deps, p);
    case "installation_repositories":
      return onInstallationRepositories(deps, p);
  }

  // Everything else is repository-scoped; ignore repos nobody linked.
  const repo = p.repository?.id
    ? await deps.db.repository.findUnique({ where: { githubId: BigInt(p.repository.id) } })
    : null;
  if (!repo || (await projectsForRepo(deps, repo.id)).length === 0) return "ignored";

  switch (event) {
    case "repository":
      return onRepository(deps, repo.id, p);
    case "push":
      return onPush(deps, repo, p);
    case "pull_request":
      return onPullRequest(deps, repo, p);
    case "pull_request_review":
      return onReview(deps, repo, p);
    case "issues":
      return onIssue(deps, repo, p);
    case "release":
      if (!["published", "released"].includes(p.action)) return "ignored";
      await mirrorRelease(deps, repo, p.release as GhRelease);
      return "processed";
    case "deployment":
      await mirrorDeployment(deps, repo, p.deployment, null);
      return "processed";
    case "deployment_status":
      await mirrorDeployment(deps, repo, p.deployment, p.deployment_status);
      return "processed";
    default:
      return "ignored";
  }
}

async function onInstallation(deps: WorkerDeps, p: Payload): Promise<"processed"> {
  const inst = p.installation;
  const id = BigInt(inst.id);
  const account = inst.account ?? {};
  const login: string | undefined = account.login ?? account.slug;

  if (p.action === "deleted") {
    await deps.db.githubInstallation.updateMany({ where: { id }, data: { deletedAt: new Date() } });
    await deps.db.repository.updateMany({
      where: { installationId: id },
      data: { installationId: null, syncStatus: "FAILED", syncError: "The bld.t GitHub App was uninstalled from this account." },
    });
    return "processed";
  }

  // No account, no record: never store an invented owner.
  if (!account.id || !login) return "processed";
  await deps.db.githubInstallation.upsert({
    where: { id },
    create: {
      id,
      accountLogin: login,
      accountId: BigInt(account.id),
      accountType: inst.target_type ?? account.type ?? "User",
      repoSelection: inst.repository_selection ?? "selected",
      suspendedAt: p.action === "suspend" ? new Date() : null,
    },
    update: {
      accountLogin: login,
      repoSelection: inst.repository_selection ?? "selected",
      suspendedAt: p.action === "suspend" ? new Date() : p.action === "unsuspend" ? null : undefined,
      deletedAt: null,
    },
  });
  return "processed";
}

async function onInstallationRepositories(deps: WorkerDeps, p: Payload): Promise<"processed"> {
  const id = BigInt(p.installation.id);
  const removed: { id: number }[] = p.repositories_removed ?? [];
  if (removed.length) {
    await deps.db.repository.updateMany({
      where: { githubId: { in: removed.map((r) => BigInt(r.id)) }, installationId: id },
      data: { installationId: null, syncStatus: "FAILED", syncError: "Access to this repository was removed from the bld.t GitHub App." },
    });
  }
  const added: { id: number }[] = p.repositories_added ?? [];
  if (added.length) {
    // Repos that lost access earlier and were re-added: restore and resync.
    const restored = await deps.db.repository.findMany({ where: { githubId: { in: added.map((r) => BigInt(r.id)) } }, select: { id: true } });
    await deps.db.repository.updateMany({
      where: { id: { in: restored.map((r) => r.id) } },
      data: { installationId: id, syncStatus: "QUEUED", syncError: null },
    });
    for (const r of restored) await deps.jobs.enqueue("repo.sync", { repositoryId: r.id, reason: "webhook" }, { dedupeId: r.id });
  }
  return "processed";
}

async function onRepository(deps: WorkerDeps, repositoryId: string, p: Payload): Promise<"processed"> {
  const r = p.repository;
  if (p.action === "deleted") {
    await deps.db.repository.update({
      where: { id: repositoryId },
      // No installation, no scheduled retries against a repository that is gone.
      data: { installationId: null, syncStatus: "FAILED", syncError: "This repository was deleted on GitHub." },
    });
    return "processed";
  }
  await deps.db.repository.update({
    where: { id: repositoryId },
    data: {
      ownerLogin: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      htmlUrl: r.html_url,
      homepageUrl: r.homepage || null,
      defaultBranch: r.default_branch,
      isPrivate: r.private,
      isArchived: r.archived,
      topics: r.topics ?? [],
      stars: r.stargazers_count ?? 0,
    },
  });
  return "processed";
}

async function onPush(deps: WorkerDeps, repo: { id: string; fullName: string; defaultBranch: string }, p: Payload): Promise<"processed" | "ignored"> {
  // Only the default branch tells the project story; feature branches surface through PRs.
  if (p.ref !== `refs/heads/${repo.defaultBranch}` || p.deleted) return "ignored";
  const commits: { id: string; message: string; author?: { username?: string } }[] = p.commits ?? [];
  if (commits.length === 0) return "ignored";

  const projectIds = await projectsForRepo(deps, repo.id);
  const login: string | null = p.sender?.login ?? p.pusher?.name ?? null;
  await recordActivity(
    deps.db,
    projectIds.map((projectId) => ({
      projectId,
      type: "github.push",
      source: "GITHUB" as const,
      externalId: `push:${p.after}`,
      trust: "CONNECTED" as const,
      actorLogin: login,
      occurredAt: p.head_commit?.timestamp ? new Date(p.head_commit.timestamp) : new Date(),
      payload: {
        repo: repo.fullName,
        branch: repo.defaultBranch,
        count: p.size ?? commits.length,
        compareUrl: p.compare,
        head: String(p.after).slice(0, 7),
        // First line of up to three commit messages; enough context without mirroring history.
        messages: commits.slice(-3).map((c) => c.message.split("\n")[0]!.slice(0, 120)),
      },
    })),
  );

  await deps.jobs.enqueue("repo.sync", { repositoryId: repo.id, reason: "webhook" }, { dedupeId: repo.id, delayMs: PUSH_SYNC_DELAY_MS });
  return "processed";
}

async function onPullRequest(deps: WorkerDeps, repo: { id: string; fullName: string }, p: Payload): Promise<"processed" | "ignored"> {
  const relevant = ["opened", "reopened", "closed", "edited", "ready_for_review", "converted_to_draft", "synchronize"];
  if (!relevant.includes(p.action)) return "ignored";
  const pr = p.pull_request as GhPull;
  await mirrorPullRequest(deps, repo, pr, { recordEvents: true });
  if (pr.user) await refreshPrCounts(deps, repo.id, pr.user.login, BigInt(pr.user.id));
  return "processed";
}

async function onReview(deps: WorkerDeps, repo: { id: string; fullName: string }, p: Payload): Promise<"processed" | "ignored"> {
  if (p.action !== "submitted" || !p.review?.user) return "ignored";
  const reviewer = p.review.user as { login: string; id: number };
  const pr = p.pull_request;
  // Self-reviews (comment replies on your own PR) are not review evidence.
  if (pr.user?.id === reviewer.id) return "ignored";

  const projectIds = await projectsForRepo(deps, repo.id);
  for (const projectId of projectIds) {
    // One transaction: if the count failed after the event was stored, a redelivery would see the
    // event and skip the count forever.
    await deps.db.$transaction(async (tx) => {
      const inserted = await recordActivity(tx, {
        projectId,
        type: "github.review",
        source: "GITHUB",
        externalId: `review:${p.review.id}`,
        trust: "CONNECTED",
        actorLogin: reviewer.login,
        occurredAt: new Date(p.review.submitted_at ?? Date.now()),
        payload: { number: pr.number, title: pr.title, url: p.review.html_url, state: p.review.state, repo: repo.fullName },
      });
      // Count each review once even if the webhook is redelivered.
      if (inserted > 0) {
        await tx.contribution.upsert({
          where: { projectId_repositoryId_githubLogin: { projectId, repositoryId: repo.id, githubLogin: reviewer.login } },
          create: { projectId, repositoryId: repo.id, githubLogin: reviewer.login, githubUserId: BigInt(reviewer.id), reviews: 1 },
          update: { reviews: { increment: 1 }, githubUserId: BigInt(reviewer.id) },
        });
      }
    });
  }
  return "processed";
}

const ISSUE_ACTIONS = new Set(["opened", "edited", "closed", "reopened", "assigned", "unassigned", "deleted", "transferred"]);

/** Issue changes keep the mirrored task current; opening and closing also reach the activity feed. */
async function onIssue(deps: WorkerDeps, repo: { id: string; fullName: string }, p: Payload): Promise<"processed" | "ignored"> {
  if (!ISSUE_ACTIONS.has(p.action) || !p.issue || p.issue.pull_request) return "ignored";
  const issue = p.issue as GhIssue;
  // Transferred out or deleted: the task stays as history, canceled.
  await mirrorIssue(deps, repo, issue, { deleted: p.action === "deleted" || p.action === "transferred" });
  if (p.action === "opened" || p.action === "closed") {
    const sender = p.sender as { login: string; id: number } | undefined;
    const account = sender ? await deps.db.githubAccount.findUnique({ where: { githubUserId: BigInt(sender.id) }, select: { userId: true } }) : null;
    for (const projectId of await projectsForRepo(deps, repo.id)) {
      const task = await deps.db.task.findUnique({ where: { projectId_githubIssueId: { projectId, githubIssueId: BigInt(issue.id) } }, select: { number: true, title: true, status: true, project: { select: { key: true } } } });
      if (!task) continue;
      if (p.action === "closed" && task.status !== "DONE") continue;
      await recordActivity(deps.db, {
        projectId,
        type: p.action === "opened" ? "task.created" : "task.completed",
        source: "GITHUB",
        externalId: `issue-${p.action}:${issue.id}:${p.action === "closed" ? issue.closed_at : issue.created_at}`,
        trust: "CONNECTED",
        actorId: account?.userId ?? null,
        actorLogin: sender?.login ?? null,
        payload: { identifier: `${task.project.key}-${task.number}`, title: task.title, number: task.number, via: { kind: "issue", number: issue.number, url: issue.html_url } },
      });
    }
  }
  return "processed";
}
