import "dotenv/config";
import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import {
  processMarkdownQueue,
  reconcileCountersQueue,
  sendNotificationQueue,
  flushViewCountsQueue,
} from "@/lib/queues";

/**
 * Bull Board — dev-only queue dashboard on its own port (PRD §6.5), used to
 * show jobs processing in real time during the demo.
 *
 * Deliberately a separate Express process rather than a Next.js route: it is a
 * development tool, and mounting it in the app would put queue internals on a
 * public surface.
 */
const PORT = Number(process.env.BULL_BOARD_PORT ?? 3001);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/");

createBullBoard({
  queues: [
    new BullMQAdapter(processMarkdownQueue),
    new BullMQAdapter(reconcileCountersQueue),
    new BullMQAdapter(sendNotificationQueue),
    new BullMQAdapter(flushViewCountsQueue),
  ],
  serverAdapter,
});

const app = express();
app.use("/", serverAdapter.getRouter());

app.listen(PORT, () => {
  console.log(`bull board → http://localhost:${PORT}`);
});
