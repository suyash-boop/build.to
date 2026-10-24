# Project B — build.to Projects

This workspace is integrated into **Project A**, not a second product or database.
The unmodified upstream overview is in `UPSTREAM.md`; its standalone setup instructions
and migration commands do **not** apply to this merged repository.

- Public entry: `http://localhost:3000/projects`
- Personal workspace: `/projects/home`
- Project: `/projects/{owner}/{slug}`
- Community and articles: `/`, `/{username}`, `/{username}/{article}`
- Sign-in: Project A's BetterAuth only (Google/GitHub).
- API: `apps/api` (:4000), through `/projects/api/*`.
- UI: `apps/web` (:3002), reverse-proxied by A under `/projects`.
- Worker: `apps/worker`, retaining GitHub sync, signals, notifications, and delivery jobs.

## One database and one identity

All processes use the **same root `DATABASE_URL`**. A's `user` table owns the identity.
B's `displayName` and `avatarUrl` are Prisma aliases for A's `name` and `profileImage`;
there are no synchronized duplicate users. Existing text user IDs are preserved.
Project IDs remain UUIDs. Project comments and notifications have their own domain
tables so they cannot overwrite article comments/notifications.

The root `prisma/` migration history is the **only migration authority**. Run commands
from the repository root. Never apply B's archived upstream migrations to the shared DB.
`scripts/workspace-schema.mjs` generates A's additive workspace models and B's mapped
Prisma client schema from `packages/db/prisma/domain.prisma`. Do not edit generated schemas.

B validates browser cookies against A's internal BetterAuth endpoint, not a user-id header
or another sign-in cookie. Device tokens remain separately revocable and belong to the
same A user. Signing out of the workspace calls A's sign-out endpoint.

GitHub App authorization is an explicit **account-linking** step. It never creates a
new platform user or links accounts based on unverified email matches. Manual projects,
tasks, memberships, discussions, milestones and shipping work without GitHub credentials.

## UI integration

A is the front door. Both zones share branding, system typography, indigo actions,
warm surfaces, and the `theme` cookie. The workspace keeps its specialized boards,
command palette, charts, and accessible dialogs. Cross-zone links use full document
navigation intentionally; internal workspace links retain Next.js navigation.

Private project names do not appear on public community profiles. Workspace notifications
contribute to A's bell badge and link to the project inbox. Build history links back to
the community profile. Partial account deletion from B is disabled to protect A's content.
