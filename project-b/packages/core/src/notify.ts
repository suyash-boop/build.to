import type { Db, Prisma } from "@bldt/db";

type Tx = Db | Prisma.TransactionClient;

/**
 * Notification types:
 * invitation.received, request.received, request.approved, request.declined,
 * task.assigned, task.commented, project.shipped, member.joined
 */
export async function notify(
  db: Tx,
  recipients: string[],
  type: string,
  data: Record<string, unknown>,
  opts: { projectId?: string; exclude?: string | null; membersOnly?: boolean } = {},
) {
  let ids = [...new Set(recipients)].filter((id) => id !== opts.exclude);
  // Content from a project (comment excerpts, titles) only reaches its current members: someone
  // removed from a project stops hearing about it even if they authored the task or thread.
  if (opts.membersOnly && opts.projectId && ids.length) {
    const members = await db.projectMember.findMany({ where: { projectId: opts.projectId, userId: { in: ids } }, select: { userId: true } });
    const allowed = new Set(members.map((m) => m.userId));
    ids = ids.filter((id) => allowed.has(id));
  }
  if (ids.length === 0) return;
  await db.notification.createMany({
    data: ids.map((recipientId) => ({
      recipientId,
      type,
      projectId: opts.projectId ?? null,
      data: data as Prisma.InputJsonValue,
    })),
  });
}
