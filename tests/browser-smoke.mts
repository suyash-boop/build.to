import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { serializeSignedCookie } from "better-call";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const target = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_REDIS_URL;
if (!target || !redis) throw new Error("Set explicit, isolated TEST_DATABASE_URL and TEST_REDIS_URL.");
const url = new URL(target);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("_test")) throw new Error("Refusing to use a non-local or non-test database.");
if (!["localhost", "127.0.0.1"].includes(new URL(redis).hostname)) throw new Error("Use an isolated local Redis service.");
const tooling = process.env.PLAYWRIGHT_MODULE;
const artifacts = process.env.BROWSER_ARTIFACTS;
if (!tooling || !artifacts) throw new Error("Set PLAYWRIGHT_MODULE to playwright/index.mjs and BROWSER_ARTIFACTS to a temporary directory.");
const { chromium } = await import(pathToFileURL(tooling).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const secret = randomBytes(48).toString("base64url");
const origin = "http://localhost:3000";
for (const port of [3000, 3002, 4000]) {
  try {
    await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(750) });
    throw new Error(`Port ${port} is in use; refusing to replace a running service.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("in use")) throw error;
  }
}
await mkdir(artifacts, { recursive: true });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target }) });
const suffix = randomBytes(4).toString("hex");
const id = `ui_${suffix}`;
const username = id;
await prisma.user.create({ data: { id, username, name: "Browser Builder", email: `${id}@example.test` } });
const token = randomBytes(32).toString("base64url");
await prisma.session.create({ data: { id: `ui_session_${suffix}`, token, userId: id, expiresAt: new Date(Date.now() + 3600000) } });
await prisma.post.create({ data: { userId: id, title: "Our shared build story", slug: `story-${suffix}`, bodyMarkdown: "The community and workspace share one identity.", processedHtml: "<p>The community and workspace share one identity.</p>", processingState: "READY", published: true, publishedAt: new Date() } });
await prisma.project.create({ data: { ownerId: id, name: "Starter project", key: "START", slug: `starter-${suffix}`, visibility: "PUBLIC", members: { create: { userId: id, role: "OWNER" } } } });
const service = spawn(process.execPath, [path.join(root, "scripts/start.mjs")], { cwd: root, env: {
  ...process.env, DATABASE_URL: target, REDIS_URL: redis, BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: origin, WEB_ORIGIN: origin, AUTH_INTERNAL_URL: "http://127.0.0.1:3000",
  API_INTERNAL_URL: "http://127.0.0.1:4000", ENCRYPTION_KEY: randomBytes(32).toString("base64"), COOKIE_SECRET: randomBytes(48).toString("base64url"),
}, stdio: "inherit" });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [];
try {
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const health = await fetch(`${origin}/projects/api/readyz`, { signal: AbortSignal.timeout(3000) });
      if (health.ok) break;
    } catch { /* Servers are starting; bounded readiness wait, not tool polling. */ }
    if (Date.now() > deadline || service.exitCode !== null) throw new Error("Combined build did not start.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const signed = (await serializeSignedCookie("better-auth.session_token", token, secret)).split(";")[0]!;
  await context.addCookies([{ name: "better-auth.session_token", value: signed.slice(signed.indexOf("=") + 1), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }, { name: "theme", value: "light", domain: "localhost", path: "/", sameSite: "Lax" }]);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error: Error) => errors.push(error.message));
  // React can report suspension/hydration failures through console.error without
  // throwing a page exception. Those must fail the regression run as well.
  page.on("console", (message: { type(): string; text(): string }) => {
    if (message.type() === "error" && /use\(\).*suspend|uncached promise|hydration|rendered (?:more|fewer) hooks|invalid hook call/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.goto(`${origin}/${username}`);
  await page.getByText("Building & shipping", { exact: true }).waitFor();
  await page.getByText("Starter project", { exact: true }).waitFor();
  console.log("✓ A's real profile displays B's project from the shared database");

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.waitForURL("**/projects/home");
  await page.getByText("Your build space", { exact: true }).waitFor();
  assert.equal((await (await page.request.get(`${origin}/projects/api/me`)).json()).id, id);
  await page.screenshot({ path: path.join(artifacts, "workspace-desktop-light.png"), fullPage: true });
  console.log("✓ cross-zone navigation preserves the same signed-in user");

  await page.goto(`${origin}/projects/new?blank=1`);
  await page.getByLabel("Name", { exact: true }).fill(`Browser build ${suffix}`);
  await page.getByLabel("Task key", { exact: true }).fill("SMOKE");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(`**/projects/${username}/browser-build-${suffix}`);
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.waitForURL("**/tasks");
  await page.getByRole("button", { name: /^New task/ }).first().click();
  await page.getByLabel("Task title", { exact: true }).fill("Ship the merged experience");
  await page.getByRole("button", { name: /^Create task/ }).click();
  await page.getByText("Ship the merged experience", { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(artifacts, "task-board-desktop.png"), fullPage: true });
  console.log("✓ projects and tasks can be created through the UI");

  await page.goto(`${origin}/projects/settings`);
  await page.getByLabel("Name", { exact: true }).fill("Shared Browser Builder");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByText("Profile saved", { exact: true }).waitFor();
  await page.goto(`${origin}/${username}`);
  await page.getByRole("heading", { name: "Shared Browser Builder", exact: true }).waitFor();
  console.log("✓ editing the workspace profile updates A's visible identity");

  await page.goto(`${origin}/projects/home`);
  await page.getByRole("button", { name: /Shared Browser Builder/ }).click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(artifacts, "workspace-desktop-dark.png"), fullPage: true });
  await page.goto(`${origin}/${username}`);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  console.log("✓ theme preference is shared across both zones");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/projects/home`);
  await page.getByText("Your build space", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, "workspace-mobile.png"), fullPage: true });
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((el) => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })) }));
  assert.ok(overflow.scroll <= overflow.width, `Workspace overflows a mobile viewport: ${JSON.stringify(overflow)}`);
  console.log("✓ mobile workspace fits the viewport");

  await page.goto(`${origin}/${username}`);
  await page.getByRole("heading", { name: "Shared Browser Builder", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Community profile overflows a mobile viewport");
  await page.getByRole("link", { name: "Projects", exact: true }).waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(artifacts, "community-mobile.png"), fullPage: true });
  console.log("✓ A's signed-in mobile profile fits with the Projects navigation");
  await page.goto(`${origin}/projects/home`);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /Shared Browser Builder/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.waitForURL(origin + "/");
  await page.getByRole("link", { name: "Log in", exact: true }).first().waitFor();
  assert.equal((await page.request.get(`${origin}/projects/api/me`)).status(), 401);
  assert.deepEqual(errors, [], `Browser exceptions: ${errors.join("; ")}`);
  console.log("✓ workspace sign-out signs out of A too; no browser exceptions");
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  if (service.pid && service.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(service.pid), "/T", "/F"], { stdio: "ignore" });
    else service.kill("SIGTERM");
  }
  await prisma.project.deleteMany({ where: { ownerId: id } });
  await prisma.user.deleteMany({ where: { id } });
  await prisma.$disconnect();
}
