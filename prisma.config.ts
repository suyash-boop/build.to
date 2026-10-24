import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 moved the migration/introspection connection URL out of schema.prisma
// and into this file. Prisma 7 does not auto-load .env, hence the import above.
export default defineConfig({
  schema: "prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
