import { linkPullRequest, recordActivity, recordRelease, type ActivityInput } from "@bldt/core";
import type { DeploymentState, Repository } from "@bldt/db";
import type { WorkerDeps } from "./context.ts";

/** Minimal shapes shared by REST list responses and webhook payloads. */
export interface GhPull {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: string;
  draft?: boolean;
  merged_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at?: string;
  user: { login: string; id: number } | null;
  head: { ref: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface GhRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body?: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  target_commitish?: string;
  author?: { login: string } | null;
}

export async function projectsForRepo(deps: WorkerDeps, repositoryId: string) {
  const links = await deps.db.projectRepository.findMany({
    where: { repositoryId, project: { deletedAt: null } },
    select: { projectId: true },
  });
  return links.map((l) => l.projectId);
}

/** Upsert a PR mirror, link it to tasks, and record feed events. `recordEvents` is false for old backfill. */
export async function mirrorPullRequest(
  deps: WorkerDeps,
  repo: Pick<Repository, "id" | "fullName">,
  pr: GhPull,
  opts: { recordEvents: boolean },
) {
  const state = pr.merged_at ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN";
  const base = {
    repositoryId: repo.id,
    number: pr.number,
    title: pr.title.slice(0, 500),
    htmlUrl: pr.html_url,
    state,
    isDraft: Boolean(pr.draft),
    authorLogin: pr.user?.login ?? "ghost",
    authorGithubId: pr.user ? BigInt(pr.user.id) : null,
    headRef: pr.head.ref,
    openedAt: new Date(pr.created_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
  } as const;
  // List endpoints omit size stats; keep previously known values rather than zeroing them.
  const size =
    pr.additions !== undefined
      ? { additions: pr.additions, deletions: pr.deletions ?? 0, changedFiles: pr.changed_files ?? 0 }
      : {};

  const snapshotAt = pr.updated_at ? new Date(pr.updated_at) : null;
  const existing = await deps.db.pullRequest.findUnique({ where: { githubId: BigInt(pr.id) } });
  let row = existing;
  if (!existing) {
    row = await deps.db.pullRequest.create({ data: { githubId: BigInt(pr.id), ...base, ...size, githubUpdatedAt: snapshotAt } });
  } else {
    // Deliveries can finish out of order: never apply a snapshot older than the one stored, and
    // never move a merged pull request back to open.
    const stale = Boolean(snapshotAt && existing.githubUpdatedAt && snapshotAt < existing.githubUpdatedAt);
    const regress = existing.state === "MERGED" && state !== "MERGED";
    const next = { ...base, ...size };
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => String(existing[k] ?? "") !== String(next[k] ?? ""));
    if (!stale && !regress && changed) {
      row = await deps.db.pullRequest.update({ where: { id: existing.id }, data: { ...next, ...(snapshotAt ? { githubUpdatedAt: snapshotAt } : {}) } });
    } else if (!stale && !regress && snapshotAt && (!existing.githubUpdatedAt || snapshotAt > existing.githubUpdatedAt)) {
      // Nothing visible changed; remember the snapshot time without touching updatedAt-driven signals.
      await deps.db.$executeRaw`UPDATE "PullRequest" SET "githubUpdatedAt" = ${snapshotAt} WHERE "id" = ${existing.id}::uuid`;
    }
    if (stale || regress) return existing;
  }
  if (!row) return row;

  await linkPullRequest(deps.db, row.id, pr.body ?? null);

  if (!opts.recordEvents) return row;
  const projectIds = await projectsForRepo(deps, repo.id);
  const payload = { number: pr.number, title: row.title, url: pr.html_url, repo: repo.fullName, additions: row.additions, deletions: row.deletions };
  const events: ActivityInput[] = [];
  for (const projectId of projectIds) {
    const common = { projectId, source: "GITHUB" as const, trust: "CONNECTED" as const, actorLogin: row.authorLogin, payload };
    events.push({ ...common, type: "github.pr_opened", externalId: `pr:${pr.id}:opened`, occurredAt: row.openedAt });
    if (row.mergedAt) events.push({ ...common, type: "github.pr_merged", externalId: `pr:${pr.id}:merged`, occurredAt: row.mergedAt });
    else if (row.state === "CLOSED" && row.closedAt)
      events.push({ ...common, type: "github.pr_closed", externalId: `pr:${pr.id}:closed`, occurredAt: row.closedAt });
  }
  await recordActivity(deps.db, events);
  return row;
}

/** Releases become ship events. Drafts are ignored; pre-releases never count as the launch. */
export async function mirrorRelease(deps: WorkerDeps, repo: Pick<Repository, "id" | "fullName">, rel: GhRelease) {
  if (rel.draft || !rel.published_at) return;
  const projectIds = await projectsForRepo(deps, repo.id);
  for (const projectId of projectIds) {
    await recordRelease(deps.db, {
      projectId,
      title: rel.name?.trim() || rel.tag_name,
      version: rel.tag_name,
      notes: rel.body?.slice(0, 20000) ?? null,
      url: rel.html_url,
      commitSha: rel.target_commitish && /^[0-9a-f]{40}$/.test(rel.target_commitish) ? rel.target_commitish : null,
      source: "GITHUB_RELEASE",
      externalId: String(rel.id),
      actorLogin: rel.author?.login ?? null,
      shippedAt: new Date(rel.published_at),
      allowShip: !rel.prerelease,
    });
  }
}

const STATE_MAP: Record<string, DeploymentState> = {
  pending: "PENDING",
  queued: "PENDING",
  in_progress: "IN_PROGRESS",
  success: "SUCCESS",
  failure: "FAILURE",
  error: "ERROR",
  inactive: "INACTIVE",
};

export async function mirrorDeployment(
  deps: WorkerDeps,
  repo: Pick<Repository, "id" | "fullName">,
  d: { id: number; environment: string; sha: string; ref: string; created_at: string; creator?: { login: string } | null },
  status: { state: string; environment_url?: string | null; target_url?: string | null; updated_at?: string; created_at?: string } | null,
) {
  const projectIds = await projectsForRepo(deps, repo.id);
  const state = status ? (STATE_MAP[status.state] ?? "PENDING") : "PENDING";
  const url = status?.environment_url || null;
  const updatedAt = new Date(status?.updated_at ?? status?.created_at ?? d.created_at);

  for (const projectId of projectIds) {
    const key = { projectId_githubId: { projectId, githubId: BigInt(d.id) } };
    const existing = await deps.db.deployment.findUnique({ where: key });
    // Ignore out-of-order status events.
    if (existing && existing.updatedAt > updatedAt) continue;
    await deps.db.deployment.upsert({
      where: key,
      create: {
        githubId: BigInt(d.id),
        projectId,
        repositoryId: repo.id,
        environment: d.environment.slice(0, 80),
        state,
        url,
        sha: d.sha,
        ref: d.ref.slice(0, 200),
        creatorLogin: d.creator?.login ?? null,
        createdAt: new Date(d.created_at),
        updatedAt,
      },
      update: { state, url: url ?? existing?.url ?? null, updatedAt },
    });

    // Only successful production deploys reach the feed; previews are noise.
    if (state === "SUCCESS" && /prod/i.test(d.environment)) {
      await recordActivity(deps.db, {
        projectId,
        type: "github.deployment",
        source: "GITHUB",
        externalId: `deploy:${d.id}:success`,
        trust: "CONNECTED",
        actorLogin: d.creator?.login ?? null,
        occurredAt: updatedAt,
        payload: { environment: d.environment, url, sha: d.sha.slice(0, 7), repo: repo.fullName },
      });
    }
  }
}

/** Recount PR-based contribution numbers for one author from the mirrored PR table. */
export async function refreshPrCounts(deps: WorkerDeps, repositoryId: string, login: string, githubUserId: bigint | null) {
  const [opened, merged] = await Promise.all([
    deps.db.pullRequest.count({ where: { repositoryId, authorLogin: login } }),
    deps.db.pullRequest.count({ where: { repositoryId, authorLogin: login, state: "MERGED" } }),
  ]);
  const projectIds = await projectsForRepo(deps, repositoryId);
  for (const projectId of projectIds) {
    await deps.db.contribution.upsert({
      where: { projectId_repositoryId_githubLogin: { projectId, repositoryId, githubLogin: login } },
      create: { projectId, repositoryId, githubLogin: login, githubUserId, prsOpened: opened, prsMerged: merged },
      update: { prsOpened: opened, prsMerged: merged, ...(githubUserId ? { githubUserId } : {}) },
    });
  }
}

// ── Issues ───────────────────────────────────────────────────

export interface GhIssue {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: string;
  state_reason?: string | null;
  created_at: string;
  updated_at?: string;
  closed_at?: string | null;
  user: { login: string; id: number } | null;
  assignees?: { login: string; id: number }[] | null;
  assignee?: { login: string; id: number } | null;
  /** Present when the "issue" is a pull request; those are mirrored separately. */
  pull_request?: unknown;
}

type Status = "BACKLOG" | "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELED";

/** What GitHub says the status is. Open says "not finished", nothing finer. */
function githubStatus(issue: GhIssue): Status {
  if (issue.state !== "closed") return "TODO";
  return issue.state_reason === "not_planned" || issue.state_reason === "duplicate" ? "CANCELED" : "DONE";
}

/**
 * Bring GitHub's view in without undoing bld.t work. Only transitions count: GitHub closing the
 * issue finishes the task; GitHub reopening it (closed before, open now) brings a finished task
 * back. An issue that simply stays open never touches the status, so work completed in bld.t
 * (for example by a merged "fixes KEY-12" pull request) is not undone by the next sync.
 */
export function nextStatus(current: Status, previousGithubState: string | null, issue: GhIssue): Status {
  const finished = current === "DONE" || current === "CANCELED";
  if (issue.state === "closed") {
    // Already finished here: keep bld.t's choice between Done and Canceled.
    return finished ? current : githubStatus(issue);
  }
  return previousGithubState === "closed" && finished ? "TODO" : current;
}

/**
 * Mirror one GitHub issue into a task in every project the repository is linked to. Idempotent:
 * keyed by (project, issue id), so repeated syncs and redelivered webhooks never duplicate.
 * Returns the projects where a task was created.
 */
export async function mirrorIssue(deps: WorkerDeps, repo: Pick<Repository, "id" | "fullName">, issue: GhIssue, opts: { deleted?: boolean } = {}): Promise<string[]> {
  if (issue.pull_request) return [];
  const { db } = deps;
  const created: string[] = [];
  const projectIds = await projectsForRepo(deps, repo.id);
  if (!projectIds.length) return [];

  // GitHub numeric ids survive renames; map them to bld.t accounts once.
  const ghIds = [issue.user?.id, ...(issue.assignees ?? (issue.assignee ? [issue.assignee] : [])).map((a) => a.id)].filter((x): x is number => typeof x === "number");
  const accounts = ghIds.length ? await db.githubAccount.findMany({ where: { githubUserId: { in: ghIds.map((i) => BigInt(i)) } }, select: { userId: true, githubUserId: true } }) : [];
  const userFor = (ghId?: number) => accounts.find((a) => ghId != null && a.githubUserId === BigInt(ghId))?.userId ?? null;

  for (const projectId of projectIds) {
    const members = new Set((await db.projectMember.findMany({ where: { projectId }, select: { userId: true } })).map((m) => m.userId));
    const assigneeGh = (issue.assignees ?? (issue.assignee ? [issue.assignee] : [])).map((a) => userFor(a.id)).find((u) => u && members.has(u)) ?? null;
    const existing = await db.task.findUnique({ where: { projectId_githubIssueId: { projectId, githubIssueId: BigInt(issue.id) } } });

    if (opts.deleted) {
      if (existing && existing.status !== "CANCELED") await db.task.update({ where: { id: existing.id }, data: { status: "CANCELED", completedAt: new Date() } });
      continue;
    }

    const fields = {
      title: issue.title.slice(0, 200) || `Issue #${issue.number}`,
      description: issue.body ? issue.body.slice(0, 20_000) : null,
      githubIssueNumber: issue.number,
      githubIssueUrl: issue.html_url,
      githubAuthorLogin: issue.user?.login ?? null,
    };

    const snapshotAt = issue.updated_at ? new Date(issue.updated_at) : null;
    const ghState = issue.state === "closed" ? "closed" : "open";

    if (existing) {
      // Deliveries and syncs can arrive out of order: never apply an older snapshot.
      if (snapshotAt && existing.githubUpdatedAt && snapshotAt < existing.githubUpdatedAt) continue;
      const status = nextStatus(existing.status, existing.githubIssueState, issue);
      const finished = status === "DONE" || status === "CANCELED";
      const data = {
        ...fields,
        status,
        completedAt: finished ? (existing.completedAt ?? (issue.closed_at ? new Date(issue.closed_at) : new Date())) : null,
        githubIssueState: ghState,
        // Only fill an empty assignee from GitHub; a bld.t assignment is a deliberate choice.
        ...(assigneeGh && !existing.assigneeId ? { assigneeId: assigneeGh } : {}),
      };
      const changed = (Object.keys(data) as (keyof typeof data)[]).some((k) => String((existing as Record<string, unknown>)[k] ?? "") !== String(data[k] ?? ""));
      if (changed) {
        await db.task.update({ where: { id: existing.id }, data: { ...data, ...(snapshotAt ? { githubUpdatedAt: snapshotAt } : {}) } });
      } else if (snapshotAt && (!existing.githubUpdatedAt || snapshotAt > existing.githubUpdatedAt)) {
        // Nothing visible changed: record the snapshot time without bumping updatedAt (stalled detection reads it).
        await db.$executeRaw`UPDATE "Task" SET "githubUpdatedAt" = ${snapshotAt} WHERE "id" = ${existing.id}::uuid`;
      }
      continue;
    }

    const status = githubStatus(issue);
    const author = userFor(issue.user?.id);
    try {
      await db.$transaction(async (tx) => {
        const project = await tx.project.update({ where: { id: projectId }, data: { taskCounter: { increment: 1 } }, select: { taskCounter: true, ownerId: true } });
        const last = await tx.task.findFirst({ where: { projectId, status }, orderBy: { position: "desc" }, select: { position: true } });
        await tx.task.create({
          data: {
            projectId,
            number: project.taskCounter,
            ...fields,
            githubIssueId: BigInt(issue.id),
            githubIssueState: ghState,
            githubUpdatedAt: snapshotAt,
            status,
            position: (last?.position ?? 0) + 1024,
            // Someone has to be the creator: the issue author if they are a member, else the owner.
            creatorId: author && members.has(author) ? author : project.ownerId,
            assigneeId: assigneeGh,
            createdAt: new Date(issue.created_at),
            completedAt: status === "DONE" || status === "CANCELED" ? (issue.closed_at ? new Date(issue.closed_at) : new Date()) : null,
          },
        });
      });
    } catch (err) {
      // A concurrent sync or redelivered webhook created it first: the unique key did its job.
      if ((err as { code?: string }).code === "P2002") continue;
      throw err;
    }
    created.push(projectId);
  }
  return created;
}
