import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export type { Redis };

export const QUEUE = {
  github: "github",
  projects: "projects",
  /** Outbound webhook deliveries: slow third-party receivers must not hold up project jobs. */
  outbound: "outbound",
} as const;

export interface JobPayloads {
  /** Process one stored webhook delivery. */
  "webhook.process": { deliveryId: string; event: string; payload: unknown };
  /** Full repository sync: metadata, languages, README, PRs, releases, deployments, contributors, stack. */
  "repo.sync": { repositoryId: string; reason: "connect" | "manual" | "scheduled" | "webhook" };
  /** Recompute derived project data (technologies, contribution rollups, PR/task links). */
  "project.recompute": { projectId: string };
  /**
   * Per-author commit statistics. GitHub computes these lazily and answers 202 until ready,
   * so this job reschedules itself instead of blocking a full sync.
   */
  "repo.contributors": { repositoryId: string; attempt: number };
  /** Scheduled: queue syncs for repositories not refreshed recently (webhooks can be missed). */
  "repos.refresh": Record<string, never>;
  /** Scheduled: data retention (webhook logs, expired sessions and invitations). */
  "maintenance.daily": Record<string, never>;
  /** Detect and reconcile signals for one project. Debounced: bursts of changes cause one scan. */
  "signals.scan": { projectId: string };
  /** Scheduled: queue scans for active projects. */
  "signals.scanAll": Record<string, never>;
  /** Scheduled: turn new activity and signals into deliveries for subscribed endpoints, and requeue overdue ones. */
  "outbound.fanout": Record<string, never>;
  /** One delivery attempt. Retries are rescheduled by the job itself, not by BullMQ. */
  "outbound.deliver": { deliveryId: string };
  /** A user just linked GitHub; attach existing contribution evidence to their account. */
  "user.claim": { userId: string; githubUserId: string };
}

export type JobName = keyof JobPayloads;

export const JOB_QUEUE: Record<JobName, (typeof QUEUE)[keyof typeof QUEUE]> = {
  "webhook.process": QUEUE.github,
  "repo.sync": QUEUE.github,
  "repo.contributors": QUEUE.github,
  "repos.refresh": QUEUE.github,
  "maintenance.daily": QUEUE.projects,
  "signals.scan": QUEUE.projects,
  "signals.scanAll": QUEUE.projects,
  "project.recompute": QUEUE.projects,
  "user.claim": QUEUE.projects,
  "outbound.fanout": QUEUE.outbound,
  "outbound.deliver": QUEUE.outbound,
};

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** Kept briefly: these jobs carry whole webhook payloads or fire constantly, and Redis is memory. */
const JOB_RETENTION: Partial<Record<JobName, Pick<JobsOptions, "removeOnComplete" | "removeOnFail">>> = {
  "webhook.process": { removeOnComplete: { age: 3600, count: 200 }, removeOnFail: { age: 3 * 24 * 3600, count: 1_000 } },
  "outbound.deliver": { removeOnComplete: { age: 3600, count: 1_000 } },
  "outbound.fanout": { removeOnComplete: true, removeOnFail: { count: 100 } },
};

/** For job schedulers, which do not inherit a queue's default job options. */
export const SCHEDULED_JOB_OPTIONS: Pick<JobsOptions, "removeOnComplete" | "removeOnFail"> = {
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 100 },
};

export function createRedis(url: string): Redis {
  // BullMQ requires maxRetriesPerRequest: null for blocking connections.
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export class JobClient {
  private queues: Map<string, Queue>;

  constructor(private connection: Redis) {
    this.queues = new Map(
      Object.values(QUEUE).map((name) => [name, new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS })]),
    );
  }

  /**
   * Enqueue a job. Pass `dedupeId` to collapse duplicates while one is still waiting
   * (e.g. ten pushes in a row should cause one sync, not ten).
   */
  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: { dedupeId?: string; delayMs?: number } = {}) {
    const queue = this.queues.get(JOB_QUEUE[name]);
    if (!queue) throw new Error(`No queue for job ${name}`);
    return queue.add(name, data, {
      ...JOB_RETENTION[name],
      ...(opts.dedupeId ? { deduplication: { id: `${name}:${opts.dedupeId}` } } : {}),
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
    });
  }

  async close() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
