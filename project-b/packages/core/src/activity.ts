import type { Db, EventSource, Prisma, TrustLevel } from "@bldt/db";

type Tx = Db | Prisma.TransactionClient;

export interface ActivityInput {
  projectId: string;
  type: string;
  source: EventSource;
  /** Must be unique per (project, source). Re-recording the same id is a no-op. */
  externalId: string;
  trust: TrustLevel;
  actorId?: string | null;
  actorLogin?: string | null;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Idempotent: webhook redeliveries and repeated syncs never duplicate the feed.
 * Returns how many events were new, so callers can gate one-time side effects on it.
 */
export async function recordActivity(db: Tx, events: ActivityInput | ActivityInput[]): Promise<number> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return 0;
  const { count } = await db.activityEvent.createMany({
    data: list.map((e) => ({
      projectId: e.projectId,
      type: e.type,
      source: e.source,
      externalId: e.externalId,
      trust: e.trust,
      actorId: e.actorId ?? null,
      actorLogin: e.actorLogin ?? null,
      payload: e.payload as Prisma.InputJsonValue,
      occurredAt: e.occurredAt ?? new Date(),
    })),
    skipDuplicates: true,
  });
  return count;
}

/** Activity originating in bld.t. Uses a random external id since each action is unique. */
export function platformEvent(
  projectId: string,
  type: string,
  actorId: string,
  payload: Record<string, unknown>,
): ActivityInput {
  return {
    projectId,
    type,
    source: "BLDT",
    externalId: `${type}:${crypto.randomUUID()}`,
    trust: "PLATFORM",
    actorId,
    payload,
  };
}
