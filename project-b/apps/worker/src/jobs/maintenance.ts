import type { WorkerDeps } from "../context.ts";

const DAY = 24 * 3600 * 1000;
export const WEBHOOK_RETENTION_DAYS = 30;
export const EXPIRED_SESSION_GRACE_DAYS = 7;

/**
 * Daily retention: matches what the Privacy Policy promises. Change both together.
 */
export async function runMaintenance(deps: WorkerDeps, now = new Date()) {
  const { db, log } = deps;
  const [deliveries, sessions, invitations, , outbound] = await Promise.all([
    db.webhookDelivery.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * DAY) } } }),
    db.session.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - EXPIRED_SESSION_GRACE_DAYS * DAY) } } }),
    db.invitation.updateMany({ where: { status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED" } }),
    // Device sign-in codes live 15 minutes; keep a day for support, then drop.
    db.deviceAuthorization.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY) } } }),
    // Outbound delivery logs follow the same retention as inbound ones.
    db.outboundDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * DAY) }, status: { not: "PENDING" } } }),
  ]);
  log.info({ deliveries: deliveries.count, outbound: outbound.count, sessions: sessions.count, invitations: invitations.count }, "maintenance complete");
  return { deliveries: deliveries.count, sessions: sessions.count, invitations: invitations.count };
}
