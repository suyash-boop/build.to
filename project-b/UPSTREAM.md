# bld.t

A workspace for building software with other people. Projects connect to GitHub through a GitHub App. Tasks move on their own when pull requests reference them, GitHub issues sync in as tasks, and releases land on the profile of everyone who worked on them, each claim marked with where it came from.

Everything shown in the product is computed from real data: repositories, pull requests, issues, releases, deployments, and what people do on bld.t. There is no demo or sample data.

## What it does

- **Projects and tasks.** Each project has a short key, so tasks read like `KEY-12`. A branch or pull request that mentions a task moves it to *In review*; merging a PR that says `fixes KEY-12` moves it to *Done*. Open GitHub issues sync in as tasks and follow their issue.
- **Profiles made of evidence.** Merged pull requests, reviews, releases, and shipped projects, each marked *Verified from GitHub*, *Recorded on bld.t*, or *Self-reported*. Private work counts without revealing names.
- **Releases and changelog.** GitHub releases and deployments are recorded automatically. The releases page builds a changelog from merged pull requests and completed tasks (conventional commit prefixes become sections), and the Ship dialog can fill release notes from it.
- **Signals.** Stalled tasks, overdue work, pull requests waiting for review, milestones at risk, failing deploys. Raised and resolved automatically, with notifications to the right people.
- **Insights.** Throughput, cycle time, burn-up, and milestone forecasts from task history.
- **Discussions and help.** Threads per project, plus an error-help flow that fingerprints error messages and finds where the same error was solved before.
- **Coding together.** Who is online and which files they have open, overlap warnings when two people edit the same file, huddles (Jitsi, or your own meeting room), and Live Share pairing.
- **Search.** Postgres full-text search across tasks, discussions, pull requests, and releases.
- **Live updates.** Pages update as things change, over server-sent events.
- **Outbound webhooks.** Signed JSON, Slack, or Discord deliveries for project events, with retries.
- **Verifiable work records.** Ed25519-signed records of shipped work that anyone can verify at `/verify`.
- **VS Code extension.** Your tasks in the sidebar, start a task (creates the branch), current task in the status bar, teammates online, huddles, and error help. Signs in with a device code.

## Architecture

```
browser ──► web (Next.js 16) ──/api/*──► api (Fastify 5) ──► Postgres 18
VS Code ────────────┘                      │    ▲
                                           ▼    │ jobs
GitHub ──webhooks──► api ──enqueue──► Redis (BullMQ) ──► worker
```

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js UI. No database access; talks to the API over HTTP. `/api/*` is a runtime proxy to the API, so the browser sees one origin. |
| `apps/api` | Fastify service: auth, authorization, business rules, search, live updates, webhook intake. |
| `apps/worker` | BullMQ jobs: repository and issue sync, webhook processing, signals, outbound webhook delivery, scheduled refresh and retention. |
| `apps/vscode` | The VS Code extension. |
| `packages/db` | Prisma schema, migrations, technology catalog. |
| `packages/contracts` | Zod input schemas, response types, and the permission matrix shared by API and UI. |
| `packages/core` | Domain rules shared by API and worker: shipping, task transitions, activity, notifications, signals, changelog, webhook safety. |
| `packages/github` | GitHub App client, webhook signature check, task reference parser, stack detector. |
| `packages/jobs` | Typed job definitions and queue client. |
| `packages/ai` | Optional project briefs and release-note drafts. Off unless `ANTHROPIC_API_KEY` is set. |

## Run it locally

### 1. Requirements

- Node.js 22.12 or newer (24 recommended)
- pnpm 12: `npm install -g pnpm@12` (or `corepack enable`)
- Docker Desktop, running

### 2. Install and configure

```sh
git clone <this repository> bld.to
cd bld.to
pnpm install
cp .env.example .env
```

Generate the required secrets and put them in `.env`:

```sh
openssl rand -base64 32       # ENCRYPTION_KEY
openssl rand -base64 48       # COOKIE_SECRET
```

Without `openssl`, use Node: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Then create a GitHub App (next section) and fill in the `GITHUB_*` values.

### 3. Create a GitHub App

Sign-in and repository access both go through one GitHub App. Create it at **GitHub > Settings > Developer settings > GitHub Apps > New GitHub App** (or under an organization). Use `http://localhost:3000` as `WEB_ORIGIN` while developing.

| Setting | Value |
| --- | --- |
| Homepage URL | your `WEB_ORIGIN` |
| Callback URL | `{WEB_ORIGIN}/api/auth/github/callback` |
| Expire user authorization tokens | **On** (bld.t refreshes them) |
| Request user authorization (OAuth) during installation | **Off** (sign-in is a separate step with CSRF state) |
| Setup URL | `{WEB_ORIGIN}/new`, with **Redirect on update** on |
| Webhook | Active. URL `{WEB_ORIGIN}/api/webhooks/github` (locally, a smee URL, see below). Secret: a random string, also set as `GITHUB_WEBHOOK_SECRET` |
| Repository permissions | Contents: **Read**, Metadata: **Read**, Pull requests: **Read**, Issues: **Read**, Deployments: **Read** |
| Account permissions | Email addresses: **Read** |
| Subscribe to events | Push, Pull request, Pull request review, Issues, Release, Deployment, Deployment status, Repository |

Copy the **App ID**, the **slug** (the last part of the app's public URL), the **Client ID**, a new **Client secret**, and a generated **private key** (.pem) into `.env`. The private key can be pasted on one line with `\n` for newlines.

GitHub cannot reach `localhost`, so relay webhooks with smee. Create a channel at https://smee.io, use its URL as the app's webhook URL, and run:

```sh
npx smee-client --url https://smee.io/<your-channel> --target http://localhost:4000/webhooks/github
```

### 4. Start everything

```sh
pnpm infra:up                 # Postgres 18 and Redis 8 in Docker (bound to 127.0.0.1)
pnpm db:deploy                # apply all migrations
pnpm db:seed                  # technology catalog (used for stack detection)
pnpm dev                      # web on :3000, api on :4000, and the worker
```

Open http://localhost:3000, sign in with GitHub, then go to **New project**, install the app on a repository, and import it. Pull requests, issues, releases, deployments, and contributors sync in within a minute.

### 5. VS Code extension (optional)

```sh
pnpm --filter bldt run package          # builds apps/vscode/bldt.vsix and copies it to the web app
code --install-extension apps/vscode/bldt.vsix
```

Or download it from **Settings > Editors** in the web app. The extension asks for the bld.t address on first use (`http://localhost:3000` locally) and signs in with a device code.

### Useful commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run web, api, and worker with reload |
| `pnpm build` | Build everything |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Unit tests, plus API and worker integration tests against Postgres |
| `pnpm db:studio` | Browse the database |
| `pnpm infra:down` | Stop Postgres and Redis (data is kept in Docker volumes) |

### Tests

The API and worker suites run in parallel and each truncates its tables, so each has its own database. Create them once:

```sh
docker compose exec postgres psql -U bldt -c "CREATE DATABASE bldt_test"
docker compose exec postgres psql -U bldt -c "CREATE DATABASE bldt_test_worker"
pnpm db:test:prepare          # migrates both (refuses anything that is not local)
pnpm test
```

### Troubleshooting

- **`ECONNREFUSED 127.0.0.1:5432` or `:6379`**: Docker Desktop is not running, or the containers stopped. Run `pnpm infra:up`.
- **Port 4000 already in use**: an old API process is still running. Stop it, or change `API_PORT` and `API_INTERNAL_URL`.
- **Sign-in fails with a redirect error**: the app's Callback URL must be exactly `{WEB_ORIGIN}/api/auth/github/callback`.
- **Nothing syncs after importing**: check the smee relay is running and the app is subscribed to the events above. Repositories also resync on their own about twice a day.

## Deploy

The web app runs on Vercel. The API and worker are long-running processes (the API holds a database listener and streams live updates; the worker runs the job queue), so they run as containers on any host that runs Docker images: Railway, Render, Fly.io, Google Cloud Run (API only, with min instances 1), or your own server.

You need:

| Service | Suggested provider | Notes |
| --- | --- | --- |
| Postgres 18 | Neon, Supabase, RDS | Pooled `DATABASE_URL` plus direct `DIRECT_DATABASE_URL`. Backups on. |
| Redis 7+ | Upstash, Redis Cloud, Railway | `maxmemory-policy noeviction`, persistence on. |
| API + worker | Railway, Render, Fly.io | Built from the `Dockerfile` in this repository. |
| Web | Vercel | `apps/web/vercel.json` is already set up. |

### 1. Database

Create the database, then apply migrations and the technology catalog once (and again after each release that adds migrations). From your machine, with the production values exported:

```sh
DATABASE_URL="<direct connection string>" pnpm db:deploy
DATABASE_URL="<direct connection string>" pnpm db:seed
```

Or run the migration image on your host: `docker build --target migrate -t bldt-migrate .`, with `DATABASE_URL` and `DIRECT_DATABASE_URL` set.

### 2. API and worker

Create two services from this repository's `Dockerfile`, one with build target `api` and one with target `worker`.

**API** (port 4000, health checks `/healthz` and `/readyz`):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `WEB_ORIGIN` | your web address, e.g. `https://bld.example.com` |
| `DATABASE_URL`, `DIRECT_DATABASE_URL` | pooled and direct Postgres strings |
| `REDIS_URL` | `rediss://...` |
| `ENCRYPTION_KEY`, `COOKIE_SECRET` | fresh values for production |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY` | from the production GitHub App |
| `TRUST_PROXY` | `true` (requests arrive through the web app) |
| `WORK_RECORD_SIGNING_KEY` | optional, see `.env.example` |
| `ANTHROPIC_API_KEY` | optional |

**Worker** (no port): `NODE_ENV=production`, `WEB_ORIGIN`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `REDIS_URL`, the same `ENCRYPTION_KEY` as the API, and all `GITHUB_*` values. The worker refuses to start in production without `WEB_ORIGIN`. Run one or more replicas; job schedules are idempotent.

Give the API a public HTTPS address (for example `https://api.bld.example.com`). Browsers never call it directly; the web app proxies to it.

### 3. Web on Vercel

1. In Vercel, **Add New > Project** and import this repository.
2. Set **Root Directory** to `apps/web`. Framework, install, and build commands come from `apps/web/vercel.json`; leave the overrides off.
3. Under **Settings > General**, set **Node.js Version** to 24.x.
4. Add environment variables:

   | Variable | Value |
   | --- | --- |
   | `API_INTERNAL_URL` | the API address, e.g. `https://api.bld.example.com` |
   | `WEB_ORIGIN` | the address of this Vercel project, e.g. `https://bld.example.com` |
   | `TRUSTED_PROXY_HOPS` | `1` (Vercel's edge sets the visitor IP) |
   | `LEGAL_ENTITY_NAME`, `CONTACT_EMAIL`, `GOVERNING_LAW`, `POLICY_EFFECTIVE_DATE` | required; `/privacy` and `/terms` refuse to render without them |
   | `VSCODE_EXTENSION_PUBLISHED` | `false` until the extension is on the Marketplace |

5. Deploy, then add your domain under **Settings > Domains**.

The build packages the VS Code extension too, so **Settings > Editors** can offer it as a download.

Live updates stream through the web app's `/api` proxy. A Vercel function stops at its duration limit (300 seconds is set), and the browser reconnects on its own, so updates keep flowing.

### 4. Point GitHub at production

Use a separate GitHub App for production. Set its Homepage, Callback, Setup, and Webhook URLs to the production `WEB_ORIGIN` as in the table above. Webhooks go to `https://<web>/api/webhooks/github` and are proxied to the API.

### Self-hosting everything with Docker

The same `Dockerfile` also builds the web app (`--target web`, port 3000). Deploy order: run `migrate` once, start `api` and `worker`, then `web`. On the web container set `TRUSTED_PROXY_HOPS` to the number of proxies in front of it (1 for a typical load balancer).

### Operational notes

- **Live updates**: database triggers publish change hints with `pg_notify`; each API process holds one `LISTEN` connection and streams to browsers at `GET /realtime`. Behind a load balancer, use an idle timeout above 30 seconds (the stream sends a heartbeat every 25) and disable response buffering. `REALTIME=off` disables it; pages then refetch on focus.
- **Outbound webhooks** are signed (`X-Bldt-Signature: t=...,v1=...`, HMAC-SHA256 of `t.body`), sent only to public addresses on standard ports, pinned to the vetted address for the connection, retried 7 times over about 10 hours. An endpoint is turned off after 15 deliveries in a row fail every retry.
- **Work records**: public keys are served as JWKS at `/.well-known/bldt-keys.json`. Treat `WORK_RECORD_SIGNING_KEY` like a root credential. To rotate, add the old public key to `WORK_RECORD_RETIRED_KEYS` so older records keep verifying.
- **Redis** must not evict keys (`maxmemory-policy noeviction`); BullMQ depends on it.

Before going live, work through [LAUNCH.md](LAUNCH.md).
