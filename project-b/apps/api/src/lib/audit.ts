import type { Db, Prisma } from "@bldt/db";
import type { FastifyRequest } from "fastify";

type Tx = Db | Prisma.TransactionClient;

/** Administrative changes that should be traceable: roles, visibility, integrations, deletion. */
export async function audit(
  db: Tx,
  req: FastifyRequest,
  entry: { projectId?: string | null; action: string; targetId?: string | null; metadata?: Record<string, unknown> },
) {
  await db.auditLog.create({
    data: {
      projectId: entry.projectId ?? null,
      actorId: req.viewer?.id ?? null,
      action: entry.action,
      targetId: entry.targetId ?? null,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      ip: req.ip,
    },
  });
}
