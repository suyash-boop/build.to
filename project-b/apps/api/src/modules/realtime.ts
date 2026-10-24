import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { AppError } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";

/**
 * Server-sent events: a long-lived response that streams batches of "this changed" hints.
 * Browsers refetch what they show; the stream itself never carries data a member could not
 * already load.
 */
export const realtimeRoutes: FastifyPluginAsyncZod = async (app) => {
  // Read at use time: the entry point attaches the hub after the server is built.
  const hubOf = () => app.deps.realtime;

  // End open streams before the server waits for connections to drain.
  app.addHook("preClose", async () => {
    await hubOf()?.close();
  });

  app.get("/realtime", async (req, reply) => {
    const viewer = requireViewer(req);
    const hub = hubOf();
    if (!hub) throw new AppError(503, "realtime_unavailable", "Live updates are not enabled");

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Proxies such as nginx buffer by default; this streams through them.
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    res.socket?.setNoDelay(true);
    res.socket?.setTimeout(0);

    let closed = false;
    let sub;
    try {
      sub = await hub.subscribe({
      userId: viewer.id,
      sessionId: req.sessionId,
      write: (frame) => (closed ? false : res.write(frame)),
      buffered: () => res.writableLength,
      end: () => {
        closed = true;
        res.end();
      },
      });
    } catch (err) {
      // Headers are already sent; end the stream so the client reconnects, and free the slot.
      req.log.warn({ err }, "realtime subscribe failed");
      res.end();
      return;
    }
    req.raw.on("close", () => {
      closed = true;
      hub.unsubscribe(sub);
    });
    if (req.raw.destroyed) {
      hub.unsubscribe(sub);
      return;
    }
    // Reconnect after 3s, and a first frame so the client knows the stream is live.
    res.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);
  });
};
