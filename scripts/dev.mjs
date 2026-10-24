import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error("BETTER_AUTH_SECRET is required. Copy .env.example to .env first.");
// Stable, domain-separated development keys. Production must supply independent
// keys explicitly; these are never printed or written to source control.
const derive = (purpose) => createHash("sha256").update(`${purpose}:${secret}`).digest("base64");
const env = { ...process.env,
  WEB_ORIGIN: process.env.WEB_ORIGIN || process.env.BETTER_AUTH_URL || "http://localhost:3000",
  AUTH_INTERNAL_URL: process.env.AUTH_INTERNAL_URL || "http://127.0.0.1:3000",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || derive("workspace-encryption"),
  COOKIE_SECRET: process.env.COOKIE_SECRET || derive("workspace-oauth"),
};
const command = process.argv.includes("--projects-only")
  ? ["-n", "projects,api,jobs", "-c", "cyan,yellow,magenta", "npm run dev -w @bldt/web", "npm run dev -w @bldt/api", "npm run dev -w @bldt/worker"]
  : ["-n", "community,articles,board,projects,api,jobs", "-c", "blue,magenta,green,cyan,yellow,red", "npm run dev:web", "npm run dev:worker", "npm run dev:board", "npm run dev -w @bldt/web", "npm run dev -w @bldt/api", "npm run dev -w @bldt/worker"];
const concurrently = JSON.parse(readFileSync(path.join(root, "node_modules/concurrently/package.json"), "utf8"));
const cli = path.resolve(root, "node_modules/concurrently", concurrently.bin.concurrently);
const child = spawn(process.execPath, [cli, "--kill-others", ...command], { cwd: root, env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
