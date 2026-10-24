# build.to

A developer community for **sharing what you learn and building with other people**.
Publish technical articles, maintain a public developer profile, and collaborate
on projects, tasks, milestones, and releases—all with the same account.

## What is included

| Community · Project A | Projects workspace · Project B |
| --- | --- |
| Markdown articles, drafts, and tags | Manual projects and optional GitHub imports |
| Profiles, follows, reactions, and comments | Task boards, milestones, and team invitations |
| Search and notifications | Discussions, activity, releases, and insights |
| Repository showcases on profiles | Optional repository sync, AI, and signed work records |

The community is the main interface at `/`. Choose **Projects** in the header to
enter the workspace at `/projects/home`, or browse `/projects/discover`.
Both interfaces share one PostgreSQL database, one user identity, browser login,
profile fields, and light/dark preference. Private projects remain access-controlled.

## Architecture

```text
Browser → Project A / community + BetterAuth (:3000)
              └─ /projects/* → Project B / workspace UI (:3002)
                                   └─ /projects/api/* → Fastify API (:4000)

Community + workspace API + background workers
              ├─ shared PostgreSQL database
              └─ shared Redis / Valkey service
```

- **Web:** Next.js 16, React 19, TypeScript, Tailwind CSS 4.
- **Identity:** BetterAuth in A; B verifies the same browser session with A.
- **Data:** PostgreSQL and Prisma 7, with one root migration history.
- **Services:** Fastify, BullMQ, and Redis/Valkey; npm workspaces and one lockfile.
- Cross-zone links use full-page navigation; workspace links use client navigation.

## Getting started

### 1. Prerequisites

- Node.js **24** and npm.
- PostgreSQL **15+**.
- Redis/Valkey **7+**.
- Google and/or GitHub OAuth credentials for browser sign-in.

Clone the repository and create the local environment file:

```sh
git clone https://github.com/suyash-boop/build.to.git
cd build.to
```

Copy `.env.example` to `.env` using your editor, `cp .env.example .env` on
macOS/Linux, or `Copy-Item .env.example .env` in PowerShell. **Never overwrite an
existing `.env` or commit real credentials.**

### 2. Start the database and cache

For a fresh local setup, these Docker commands match `.env.example`:

```sh
docker run --name build-to -e POSTGRES_USER=buildto -e POSTGRES_PASSWORD=buildto -e POSTGRES_DB=buildto -p 127.0.0.1:5440:5432 -v build-to-pgdata:/var/lib/postgresql/data -d postgres:15
docker run --name build-to-redis -p 127.0.0.1:6380:6379 -d valkey/valkey:8-alpine
```

If those containers already exist, use `docker start build-to build-to-redis`
instead. For existing infrastructure, set `DATABASE_URL` and `REDIS_URL` to its
addresses; do not create a second database for the workspace.

### 3. Configure sign-in

In `.env`, set the database/cache URLs, `BETTER_AUTH_SECRET`, and the credentials
for your chosen OAuth provider. Generate a local auth secret with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Register the appropriate provider callback:

| Provider | Local OAuth callback |
| --- | --- |
| Google | `http://localhost:3000/api/auth/callback/google` |
| GitHub OAuth App | `http://localhost:3000/api/auth/callback/github` |

Keep `BETTER_AUTH_URL` and `WEB_ORIGIN` set to `http://localhost:3000` locally.
The GitHub OAuth App used for **sign-in** is separate from the optional GitHub
App used for **repository access**.

### 4. Install, migrate, and run

**Back up an existing database before applying migrations.** Then run from the
repository root:

```sh
npm ci
npm run db:deploy
npm run db:seed:projects
npm run dev
```

`npm ci` generates both Prisma clients. The project seed only upserts the
technology catalog; it does not delete articles, accounts, or project data.
Open **http://localhost:3000**, sign in, choose a username once, and select
**Projects**. Manual projects, tasks, discussions, and invitations work without
GitHub App credentials.

### Local services

| Process | Port | Purpose |
| --- | --- | --- |
| Community / A | 3000 | Browser entry and BetterAuth authority |
| Projects UI / B | 3002 | Proxied under `/projects/*` |
| Projects API | 4000 | Proxied under `/projects/api/*`; loopback-only by default |
| Bull Board | 3001 | Development-only article queue dashboard |
| Article worker | — | Markdown, notifications, counters, and views |
| Project worker | — | Repository sync, signals, events, and webhooks |

Use **port 3000** in your browser, not the internal workspace/API ports.
`npm run dev:a` starts only the community services. `npm run dev:projects` starts
the project services when A is already running. The combined launcher loads root
`.env` and supplies local-only encryption/cookie defaults when they are unset.

## Optional integrations

### GitHub repository access

Configure `GITHUB_APP_*` and `GITHUB_WEBHOOK_SECRET` in `.env`, restart the
services, then connect GitHub in **Workspace settings**. This links repository
access to the existing build.to account; it does not create another platform user.

| GitHub App setting | Local URL |
| --- | --- |
| Callback | `http://localhost:3000/projects/api/auth/github/callback` |
| Setup | `http://localhost:3000/projects/new` |
| Webhook | `http://localhost:3000/projects/api/webhooks/github` |

GitHub needs a publicly reachable HTTPS webhook endpoint for live deliveries;
localhost alone is not sufficient. Store the private key securely and preserve
the encryption key used for stored GitHub tokens.

### AI and signed work records

`ANTHROPIC_API_KEY` enables the optional AI integration.
`WORK_RECORD_SIGNING_KEY` enables signed work records and must contain the
base64-encoded Ed25519 PKCS#8 DER private key expected by the service.
These integrations remain disabled without their credentials.

## Database ownership and safety

| File | Role |
| --- | --- |
| `prisma/schema.prisma` | Canonical community models and shared user |
| `prisma/workspace.prisma` | Generated project domain models |
| `prisma/migrations/` | **Only migration history to apply** |
| `project-b/packages/db/prisma/domain.prisma` | Workspace domain source |
| `project-b/packages/db/prisma/schema.prisma` | Generated workspace client projection |

Run `npm run db:generate` after schema-source changes. B's `displayName` and
`avatarUrl` map directly to A's `name` and `profileImage` on the same physical
`user` row. Existing text user IDs are preserved. Article and workspace comments
and notifications are separate domain tables in the same database.

**Do not apply B's archived upstream migrations, run `db:reset`, or run legacy
destructive seeds against an existing database.** Workspace-only account deletion
is disabled to prevent partial deletion of the shared identity and articles.

The integration imported B's **source and schema**, not rows from a separate live
B deployment. Importing those rows requires a database export and an explicit
identity-matching import. Pushing this repository to GitHub does **not** upload
database contents or apply migrations to a remote database.

See [the integration notes](project-b/README.md) and the historical
[merge validation report](MERGE_REPORT.md).

## Production

Set production URLs and secrets before building. `PROJECTS_WEB_URL` is used by A's
build-time rewrite; `AUTH_INTERNAL_URL` and `API_INTERNAL_URL` are service-to-service
addresses. Keep those services private and expose the public HTTPS origin only.
When deploying services separately, route all `/projects/*` traffic—including
assets and API streaming—to B's web service.

Production requires explicit, stable `ENCRYPTION_KEY` (32 random bytes, base64)
and `COOKIE_SECRET`, as well as database/cache/auth configuration. Do not use
development-derived keys in a deployment. Fill the legal operator fields in
`.env.example` before publishing the workspace legal pages.

```sh
npm ci
npm run db:deploy
npm run db:seed:projects
npm run build
npm start
```

The combined production launcher starts both web apps, the project API, and both
workers; it does not expose the development queue dashboard. A single standalone
Next.js deployment will not replace the required API/worker processes.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run test:projects
npm run build
npm audit --omit=dev
```

For database/auth integration checks, explicitly set `TEST_DATABASE_URL` to an
isolated local database whose name contains `_test`, and `TEST_REDIS_URL` to an
isolated local cache. Then run:

```sh
npm run test:prepare
npm run test:integration
```

The merged integration suite removes only its own fixtures; it never truncates
shared tables. Upstream B API/worker suites contain legacy truncating fixtures
and must not use real data or the same database as another running test suite.

For the real-browser smoke test, install Playwright in a separate tooling
directory. Set `PLAYWRIGHT_MODULE` to its `index.mjs`, `BROWSER_ARTIFACTS` to a
temporary output directory, and optionally `BROWSER_EXECUTABLE` to Chromium/Edge.
With isolated test URLs and ports 3000/3002/4000 free, run `npm run build`, then
`npm run test:browser`. It checks cross-zone identity, project/task creation,
profile updates, shared themes, mobile layout, and sign-out, and saves screenshots.

## Repository layout

```text
app/                  Community pages, auth routes, and server actions
components/           Community UI and shared-profile project cards
lib/                  Community data, auth, cache, and workspace queries
worker/               Community background jobs
prisma/               Canonical schema and migrations
project-b/apps/       Projects web, API, worker, and editor extension
project-b/packages/   Workspace contracts, domain logic, database, integrations
scripts/              Combined launchers, schema generation, test safeguards
tests/                Merge, database/auth, and browser regressions
```

The original `PRD.md` and B's `UPSTREAM.md` are historical references. Use this
README and the integration notes for the current merged setup.

## Troubleshooting

- **Cannot reach Projects:** use the combined `npm run dev` launcher and check
  that B's web/API processes are running. A alone cannot serve `/projects/*`.
- **Database connection refused:** start the existing database/cache containers
  and confirm their ports match `.env`; do not reset the database.
- **Repository connection unavailable:** configure the optional GitHub App, not
  just the GitHub OAuth sign-in provider. Manual projects still work.
- **React `use()` suspension warning in development:** record the affected URL,
  action, and full browser-console stack. A successful `/api/auth/get-session`
  response does not identify the cause of a React rendering warning. Try a hard
  reload and a clean browser profile to distinguish a persistent app error from
  Fast Refresh or extension-related behavior. Do not reset the database or hide
  the warning by disabling React Strict Mode.
