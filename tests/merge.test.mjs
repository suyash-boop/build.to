import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("A remains the canonical identity; workspace models do not create a second User", async () => {
  const a = await read("prisma/schema.prisma");
  const b = await read("prisma/workspace.prisma");
  assert.match(a, /model User \{/);
  assert.doesNotMatch(b, /model User \{/);
  assert.match(a, /memberships\s+ProjectMember\[\]/);
  for (const field of ["ownerId", "assigneeId", "authorId", "recipientId", "userId"]) {
    assert.doesNotMatch(b, new RegExp(`${field}\\s+String[^\\n]*@db\\.Uuid`));
  }
});

test("the workspace client maps directly to A's physical profile columns", async () => {
  const projection = await read("project-b/packages/db/prisma/schema.prisma");
  assert.match(projection, /displayName\s+String\s+@map\("name"\)/);
  assert.match(projection, /avatarUrl\s+String\?\s+@map\("profileImage"\)/);
  assert.match(projection, /@@map\("user"\)/);
  assert.match(projection, /@@map\("ProjectComment"\)/);
  assert.match(projection, /@@map\("ProjectNotification"\)/);
});

test("workspace authentication verifies A's cookies and does not trust user headers", async () => {
  const auth = await read("project-b/apps/api/src/plugins/auth.ts");
  assert.match(auth, /AUTH_INTERNAL_URL\}\/api\/auth\/get-session/);
  assert.doesNotMatch(auth, /req\.headers\["x-user-id"\]/);
  assert.doesNotMatch(auth, /const token = req\.cookies\[SESSION_COOKIE\]/);
  assert.match(auth, /session\.kind !== "DEVICE"/);
});

test("workspace requests and live updates are namespaced, leaving A's auth routes intact", async () => {
  assert.match(await read("project-b/apps/web/next.config.ts"), /basePath: "\/projects"/);
  assert.match(await read("project-b/apps/web/src/lib/api.client.ts"), /\/projects\/api\$\{path\}/);
  assert.match(await read("project-b/apps/web/src/components/shell/realtime.tsx"), /EventSource\("\/projects\/api\/realtime"\)/);
  assert.match(await read("next.config.ts"), /source: "\/projects\/:path\*"/);
});

test("public profiles enforce project visibility at the database boundary", async () => {
  const query = await read("lib/workspace.ts");
  assert.match(query, /showOnProfile: true/);
  assert.match(query, /visibility: "PUBLIC"/);
  assert.match(query, /members: \{ some: \{ userId: viewerId \} \}/);
  assert.match(query, /deletedAt: null/);
});

test("the workspace migration is additive and GitHub connection cannot create platform users", async () => {
  const sql = await read("prisma/migrations/20261023180000_merge_project_workspace/migration.sql");
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)|TRUNCATE/i);
  assert.match(sql, /REFERENCES "user"\("id"\)/);
  const connect = await read("project-b/apps/api/src/modules/auth.ts");
  assert.doesNotMatch(connect, /db\.user\.create/);
  assert.match(connect, /stored\.userId !== user\.id/);
});
