import "dotenv/config";
import { prisma } from "./lib/prisma";
import { enqueueProcessMarkdown } from "./lib/queues";

// Take a real post, blank its HTML and reset state, then enqueue it.
const post = await prisma.post.findFirst({ where: { published: true }, select: { id: true, title: true } });
if (!post) { console.log("no posts"); process.exit(0); }

await prisma.post.update({
  where: { id: post.id },
  data: { processedHtml: null, processingState: "PENDING" },
});
console.log("reset:", post.title, "→ PENDING, html=null");

const job = await enqueueProcessMarkdown(post.id);
console.log("enqueued job", job.id);

// Poll for the worker to finish
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 500));
  const p = await prisma.post.findUnique({ where: { id: post.id }, select: { processingState: true, processedHtml: true, readingTime: true } });
  if (p?.processingState === "READY") {
    console.log(`WORKER DONE after ~${(i+1)*500}ms | state=${p.processingState} | htmlLen=${p.processedHtml?.length} | readingTime=${p.readingTime}`);
    console.log("highlighting preserved:", p.processedHtml?.includes("hljs-") ? "yes" : "no");
    break;
  }
  if (i === 19) console.log("TIMEOUT — worker did not finish");
}
await prisma.$disconnect();
