# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this repo is

`build.to` is a dev.to-style social publishing platform being built as an academic learning
project. **The repo is currently an unmodified `create-next-app` scaffold** — `app/page.tsx`,
`app/layout.tsx`, and `app/globals.css` still contain boilerplate (Next.js logo, Geist fonts,
placeholder tokens). None of the product has been built yet.

**`PRD.md` is the single source of truth.** Read it before implementing anything. It is written
to be treated as a specification, not a suggestion:

- **Section 4 (Data Model)** — Prisma field names are canonical. Do not rename them or invent
  alternatives.
- **Section 8 (Design System)** — CSS token names are canonical. The current `globals.css` tokens
  are boilerplate and must be replaced with the Crayons-based tokens in 8.2–8.5.
- **Section 10 (Build Order)** — build phases in sequence; do not start phase N+1 before phase N
  works end to end.
- Decisions marked **[DECIDED]** are settled — do not re-litigate. **[OPEN]** items require asking
  before implementing.
- Do not add a dependency not listed in PRD Section 3 without asking first.

## Commands

Package manager is **npm** (see `package-lock.json`).

```bash
npm run dev      # start Next.js dev server (http://localhost:3000)
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint (flat config in eslint.config.mjs)
```

No test framework is configured yet. Once the two-process architecture (PRD 3.1) lands, `npm run dev`
is expected to boot both the web app and the `tsx watch worker/index.ts` worker via `concurrently`.

## Architecture (planned — see PRD Sections 3, 6)

The target design is **two Node processes sharing one codebase**: the Next.js web app (enqueues
jobs only) and a long-lived BullMQ worker (`worker/`) that consumes them. Stack to be installed:
PostgreSQL + Prisma, Redis, BullMQ, BetterAuth, and a unified/remark/rehype Markdown pipeline.

Non-negotiable constraints from the PRD, worth internalizing before writing code:

- **`rehypeSanitize` is mandatory** in the Markdown pipeline (`lib/markdown.ts`). HTML is stored and
  rendered with `dangerouslySetInnerHTML`; skipping sanitization is a stored-XSS hole.
- **Never instantiate a BullMQ `Worker` inside a Next.js route handler, server component, or
  middleware.** Request contexts are short-lived and orphan the worker's Redis connection. The web
  app imports `Queue` to add jobs; only `worker/` imports `Worker`.
- **`lib/markdown.ts` is shared by both the worker and the editor preview route** — preview output
  must be byte-identical to published output.
- **Job payloads carry IDs only**, never Prisma objects (payloads are JSON-serialized and objects
  go stale).
- **Every color goes through a semantic token** (PRD 8.3). No hardcoded hex in components — that is
  what breaks dark mode. Dark mode is a `data-theme` attribute on `<html>`, persisted in a cookie.
- Markdown is **processed on write, not read**; feed is **pull-based, not fan-out**; counters are
  **denormalized with background reconciliation** (PRD Section 9 — the three decisions to defend).

## Conventions

- TypeScript strict mode is on. No `any` without a comment explaining why.
- Path alias `@/*` maps to the repo root (`tsconfig.json`).
- Tailwind CSS v4 (config lives in `globals.css` via `@theme`, not a `tailwind.config.js`;
  PostCSS uses `@tailwindcss/postcss`).
- UI copy is sentence case, never Title Case (PRD 8.8).
- This is **not** the Next.js in your training data (see AGENTS.md) — consult
  `node_modules/next/dist/docs/` before using framework APIs.
