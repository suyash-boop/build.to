import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
for (const name of ["DATABASE_URL", "REDIS_URL", "BETTER_AUTH_SECRET", "ENCRYPTION_KEY", "COOKIE_SECRET"]) {
  if (!process.env[name]) throw new Error(`${name} is required for npm start. For local development use npm run dev.`);
}
const concurrently = JSON.parse(readFileSync(path.join(root, "node_modules/concurrently/package.json"), "utf8"));
const cli = path.resolve(root, "node_modules/concurrently", concurrently.bin.concurrently);
const child = spawn(process.execPath, [cli, "--kill-others", "-n", "community,articles,projects,api,jobs",
  "npm run start:a", "npx tsx worker/index.ts", "npm run start -w @bldt/web", "npm run start -w @bldt/api", "npm run start -w @bldt/worker"],
  { cwd: root, env: { ...process.env, NODE_ENV: "production", WEB_ORIGIN: process.env.WEB_ORIGIN || process.env.BETTER_AUTH_URL, AUTH_INTERNAL_URL: process.env.AUTH_INTERNAL_URL || "http://127.0.0.1:3000" }, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
