import { CursorQuery } from "@bldt/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { afterCursor, decodeCursor, page } from "../lib/cursor.ts";
import { requireViewer } from "../plugins/auth.ts";

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  app.get(
    "/notifications",
    { schema: { querystring: CursorQuery.extend({ unread: z.enum(["true", "false"]).optional() }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const cursor = decodeCursor(req.query.cursor);
      const rows = await db.notification.findMany({
        where: {
          recipientId: viewer.id,
          ...(req.query.unread === "true" ? { readAt: null } : {}),
          ...afterCursor("createdAt", cursor),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: req.query.limit + 1,
      });
      const p = page(rows, req.query.limit, (r) => r.createdAt);
      return {
        items: p.items.map((n) => ({
          id: n.id,
          type: n.type,
          data: n.data,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
        nextCursor: p.nextCursor,
      };
    },
  );

  app.post(
    "/notifications/read",
    { schema: { body: z.object({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const where = req.body.all
        ? { recipientId: viewer.id, readAt: null }
        : { recipientId: viewer.id, id: { in: req.body.ids ?? [] }, readAt: null };
      const { count } = await db.notification.updateMany({ where, data: { readAt: new Date() } });
      return { updated: count };
    },
  );
};
