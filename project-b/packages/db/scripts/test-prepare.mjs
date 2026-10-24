// Brings both local test databases up to the latest migration. Refuses anything that is not local.
import { execFileSync } from "node:child_process";

const targets = [
  process.env.TEST_DATABASE_URL ?? "postgresql://bldt:bldt@localhost:5432/bldt_test",
  process.env.WORKER_TEST_DATABASE_URL ?? "postgresql://bldt:bldt@localhost:5432/bldt_test_worker",
];

for (const url of targets) {
  const { hostname, pathname } = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(hostname)) throw new Error(`Refusing to migrate non-local database ${pathname.slice(1)}`);
  console.log(`Migrating ${pathname.slice(1)}`);
  execFileSync(process.execPath, ["./node_modules/prisma/build/index.js", "migrate", "deploy"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: "" },
  });
}
