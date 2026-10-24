import path from "node:path";
import { config } from "dotenv";
import { createDb } from "./index.ts";
import { TECHNOLOGIES } from "./technologies.ts";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const db = createDb(url, { max: 2 });

for (const t of TECHNOLOGIES) {
  await db.technology.upsert({
    where: { slug: t.slug },
    create: { slug: t.slug, name: t.name, category: t.category, color: t.color ?? null },
    update: { name: t.name, category: t.category, color: t.color ?? null },
  });
}

console.log(`Seeded ${TECHNOLOGIES.length} technologies`);
await db.$disconnect();
