# Repository guidance

@AGENTS.md

## Current architecture

This is an implemented product, not a scaffold. **Project A** is the root Next.js
community/publishing app. **Project B** lives in `project-b/` and supplies the
Projects workspace. Read `README.md` and `project-b/README.md` before changing it.
The original PRD is historical: OAuth-only login and the project integration are
intentional overrides to its initial requirements.

- npm workspaces; Node 24. Do not introduce a second lockfile/package manager.
- A is the public entry (:3000); B UI (:3002) is proxied under `/projects`.
- B API (:4000) is available at `/projects/api`. Keep A's `/api/auth` separate.
- BetterAuth in A is the only browser login authority. Never trust a user-id header.
- All processes share the root DATABASE_URL and physical `user` table.
- A's root `prisma/` is the only migration authority. Never run B's legacy migrations.
- Generate the workspace schemas with `npm run db:generate`; do not manually edit
  `prisma/workspace.prisma` or B's generated `schema.prisma`.
- Preserve A's text user IDs. B domain entities remain UUIDs.
- B's `displayName`/`avatarUrl` map to A's `name`/`profileImage`; no duplicate identity.
- Use full-document anchors between Next.js zones. Internal B links get basePath automatically.
- Keep private projects out of public profiles/search/caches. Apply authorization in the API.
- Keep article/workspace comments and notifications distinct; they are different domains.
- The shared theme cookie is `theme`, with `data-theme` on `<html>`.
- Keep BullMQ Workers outside Next.js request contexts. Preserve Markdown sanitization.

## Checks

`npm run lint`, `npm run typecheck`, `npm test`, `npm run test:projects`,
`npm run build`. For database/auth checks use `npm run test:integration` with
explicit, isolated TEST_DATABASE_URL and TEST_REDIS_URL. Never truncate user data.
Do not run destructive upstream test fixtures against the real database.
