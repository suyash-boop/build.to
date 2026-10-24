import type { SignalItem } from "@bldt/contracts";
import { resolveSettings, SIGNAL_TYPES } from "@bldt/core";
import type { Prisma } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { notFound } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

type SignalRow = Prisma.SignalGetPayload<{ include: { project: { select: { name: true; slug: true; owner: { select: { username: true } } } } } }>;

export function toSignal(s: SignalRow): SignalItem {
  return {
    id: s.id,
    type: s.type,
    severity: s.severity,
    title: s.title,
    data: (s.data ?? {}) as Record<string, unknown>,
    firstSeenAt: s.firstSeenAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    snoozedUntil: s.snoozedUntil?.toISOString() ?? null,
    project: { name: s.project.name, slug: s.project.slug, ownerUsername: s.project.owner.username },
  };
}

export const signalInclude = { project: { select: { name: true, slug: true, owner: { select: { username: true } } } } } as const;

export const sortSignals = <T extends { severity: keyof typeof SEVERITY_ORDER; firstSeenAt: string }>(a: T, b: T) =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.firstSeenAt.localeCompare(b.firstSeenAt);

const SettingsInput = z.object({
  stalledDays: z.number().int().min(1).max(60).optional(),
  reviewHours: z.number().int().min(1).max(336).optional(),
  wipLimit: z.number().int().min(1).max(20).optional(),
  atRiskBelow: z.number().min(0.1).max(0.99).optional(),
  disabled: z.array(z.enum(SIGNAL_TYPES)).max(SIGNAL_TYPES.length).optional(),
});

export const signalRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, jobs } = app.deps;

  app.get("/projects/:owner/:slug/signals", { schema: { params: ProjectParams } }, async (req) => {
    const { project } = await authorize(db, req.params, req.viewer, "tasks.view");
    const rows = await db.signal.findMany({ where: { projectId: project.id, resolvedAt: null }, include: signalInclude, take: 200 });
    const now = new Date();
    const items = rows.map(toSignal).sort(sortSignals);
    return {
      open: items.filter((s) => !s.snoozedUntil || new Date(s.snoozedUntil) <= now),
      snoozed: items.filter((s) => s.snoozedUntil && new Date(s.snoozedUntil) > now),
    };
  });

  app.post(
    "/projects/:owner/:slug/signals/:id/snooze",
    { schema: { params: ProjectParams.extend({ id: z.uuid() }), body: z.object({ days: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(7), z.literal(30)]) }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "tasks.update");
      const until = req.body.days === 0 ? null : new Date(Date.now() + req.body.days * 86_400_000);
      const { count } = await db.signal.updateMany({
        where: { id: req.params.id, projectId: project.id, resolvedAt: null },
        data: { snoozedUntil: until, snoozedById: until ? viewer.id : null },
      });
      if (count === 0) throw notFound("Signal not found");
      return { ok: true, snoozedUntil: until?.toISOString() ?? null };
    },
  );

  app.get("/projects/:owner/:slug/signal-settings", { schema: { params: ProjectParams } }, async (req) => {
    const { project } = await authorize(db, req.params, req.viewer, "tasks.view");
    return resolveSettings(project.signalSettings);
  });

  app.patch("/projects/:owner/:slug/signal-settings", { schema: { params: ProjectParams, body: SettingsInput } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "project.update");
    const next = resolveSettings({ ...resolveSettings(project.signalSettings), ...req.body });
    await db.project.update({ where: { id: project.id }, data: { signalSettings: next as unknown as Prisma.InputJsonValue } });
    await audit(db, req, { projectId: project.id, action: "signals.settings", metadata: req.body });
    // New thresholds apply right away rather than at the next sweep.
    await jobs.enqueue("signals.scan", { projectId: project.id }, { dedupeId: project.id });
    return next;
  });
};
