import path from "node:path";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
if (process.argv.includes("migrate") || process.argv.includes("push")) {
  throw new Error("Project A owns the shared schema. Run npm run db:migrate or npm run db:deploy from the repository root; do not migrate the workspace projection.");
}

/**
 * The Prisma CLI (migrate, studio) needs a direct connection: schema migrations take session-level
 * advisory locks that a transaction-mode pooler (Neon's "-pooler" host, PgBouncer) does not support.
 * The running app uses DATABASE_URL, which may be pooled. Locally both are the same database.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  // This config is for client generation only. All migration scripts delegate
  // to A's canonical history; upstream migrations are retained for reference.
  migrations: { path: "../../../prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL?.trim() ? process.env.DIRECT_DATABASE_URL.trim() : env("DATABASE_URL"),
  },
});
