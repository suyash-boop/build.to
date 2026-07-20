# build.to — Product Requirements Document

> **Project type:** Academic / end-of-semester learning project
> **Status:** Pre-development
> **Owner:** Garvit
> **Last updated:** 18 July 2026

---

## 0. How to use this document

This PRD is the single source of truth for the build.to project. It is written to be
read by both humans and AI coding agents (Claude Code).

**For AI agents working in this repo:**

- Treat Section 4 (Data Model) and Section 8 (Design System) as **specifications**, not suggestions.
  Do not invent alternative schema field names or CSS token names.
- Section 10 (Build Order) defines the sequence. Do not build phase N+1 features while phase N is incomplete.
- When a decision is marked **[DECIDED]**, do not re-litigate it. When marked **[OPEN]**, ask before implementing.
- All new code is TypeScript. No `any` without a comment explaining why.
- Before adding a dependency not listed in Section 3, ask first.

---

## 1. Project overview

### 1.1 What we are building

**build.to** is a social publishing platform for developers. Registered users write
long-form technical posts in Markdown, tag them, and publish them to a shared public
feed. Other users read, react, comment, and follow both authors and topics.

It is a content platform first and a social network second — the post is the primary
object, and every social feature (reactions, comments, follows) exists to circulate posts.

### 1.2 Why we are building it

This is a **learning project** built for an end-of-semester college submission. Its
purpose is to gain hands-on experience with production-grade architectural patterns
that are difficult to encounter in tutorial-scale projects:

- Write-time content processing instead of read-time rendering
- Denormalized counters with background reconciliation
- Multi-strategy caching (TTL, explicit invalidation, write-behind)
- Asynchronous job processing with a dedicated worker process
- Polymorphic relations in a relational schema

The architecture is modelled on **Forem** (github.com/forem/forem, AGPL-3.0), the
open-source platform that powers dev.to. Forem is used as a *reference for architectural
patterns and UI conventions*. build.to is an independent implementation in a different
language and stack, with its own name, branding, and code.

### 1.3 What success looks like

The project is successful if, at presentation time, we can:

1. Demonstrate the full loop live: register → write a post → publish → it appears in the feed → another user reacts and comments.
2. Show the BullMQ dashboard processing jobs in real time as a post is published.
3. Demonstrate counter self-healing: manually corrupt a `reactionsCount` in the DB, wait for the reconciliation job, watch it correct itself.
4. Explain and defend three architectural decisions (see Section 9).

### 1.4 Explicit non-goals

These are **out of scope**. Do not build them.

| Not building | Why |
| --- | --- |
| Real file/image uploads (S3) | URL fields are sufficient; adds infra complexity with no learning value |
| Liquid tags (`{% embed %}`) | Custom parser, large effort, zero architectural insight |
| Email sending | Requires external service; notifications are in-app only |
| Real-time websockets | Polling is fine at demo scale |
| Organizations / teams | Multiplies permission complexity |
| Podcasts, videos, listings | dev.to has these; they are not the core loop |
| Mobile apps | Responsive web only |
| Production deployment | Runs locally; deployment is not being graded |
| Payments, monetization | Irrelevant |

---

## 2. Users and core flows

### 2.1 User types

| Type | Can do |
| --- | --- |
| Anonymous visitor | Read feed, read posts, read comments, view profiles, search |
| Registered user | Everything above, plus: write/edit/delete own posts, react, comment, follow, edit own profile |

There is no admin/moderator role in the MVP. **[DECIDED]**

### 2.2 Primary user flows

**Flow A — Publish a post**
1. User clicks "Write a post" from the header
2. Editor opens with a Markdown textarea containing empty frontmatter
3. User writes title, tags, and body
4. User clicks Preview tab to check rendering
5. User clicks Publish
6. Post row is written and the user is redirected immediately to the post page
7. Background worker renders HTML; page shows a "processing" state until ready

**Flow B — Read and engage**
1. Visitor lands on the feed, sees post cards sorted by recency
2. Clicks a post, reads it
3. Reacts (heart / unicorn / bookmark) — count updates optimistically
4. Leaves a comment, or replies to an existing comment
5. Clicks the author's name, lands on their profile, follows them

**Flow C — Discover by tag**
1. User clicks a tag on a post card
2. Lands on the tag page showing posts with that tag
3. Follows the tag; future feed loads weight that tag higher

---

## 3. Technical stack **[DECIDED]**

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js (App Router) | Frontend and backend in one codebase |
| Language | TypeScript | Strict mode on |
| Database | PostgreSQL (local) | Runs locally, not containerized unless needed |
| ORM | Prisma | Migrations via `prisma migrate dev` |
| Cache | Redis | Local instance |
| Queue | BullMQ | Shares the Redis instance in dev |
| Auth | BetterAuth | Email + password; OAuth optional stretch |
| Styling | Tailwind CSS | Configured against tokens in Section 8 |
| Markdown | unified / remark / rehype | Pipeline defined in Section 6.3 |
| Frontmatter | gray-matter | Parses the editor's YAML block |
| Queue dashboard | Bull Board | Dev-only, separate port |

### 3.1 Process architecture

The application runs as **two separate Node processes** sharing one codebase:

```
next dev                  →  Web app. Handles requests. ONLY enqueues jobs.
tsx watch worker/index.ts →  Worker. Long-lived. Consumes jobs from Redis.
```

**Critical constraint:** BullMQ workers must never be instantiated inside Next.js
route handlers, server components, or middleware. Next.js request contexts are
short-lived and will orphan the worker's Redis connection. The web app imports
`Queue` instances to add jobs; only `worker/` imports `Worker`.

Use `concurrently` so `npm run dev` boots both processes.

### 3.2 Repository structure

```
/app                       Next.js App Router
  /(feed)/page.tsx         Home feed
  /[username]/page.tsx     User profile
  /[username]/[slug]/      Post detail page
  /new/page.tsx            Post editor
  /t/[tag]/page.tsx        Tag feed
  /settings/page.tsx       Profile settings
  /search/page.tsx         Search results
  /api/                    Route handlers
/components
  /ui                      Primitives (Button, Card, Avatar, Tag)
  /post                    PostCard, PostBody, ReactionBar
  /comment                 CommentThread, CommentForm
  /editor                  MarkdownEditor, PreviewPane
/lib
  prisma.ts                Prisma singleton
  redis.ts                 Redis client singleton
  queues.ts                Queue instances + typed job payloads
  markdown.ts              The unified pipeline (shared by worker + preview)
  cache.ts                 Cache get/set/invalidate helpers
  auth.ts                  BetterAuth config
/worker
  index.ts                 Worker bootstrap
  /processors              One file per job type
/prisma
  schema.prisma
  seed.ts
```

`lib/markdown.ts` is imported by **both** the worker and the editor preview route.
This is deliberate — preview must be byte-identical to published output.

---

## 4. Data model **[DECIDED]**

Prisma schema. Field names here are canonical; do not rename.

### 4.1 User

BetterAuth generates its own `Session`, `Account`, and `Verification` tables. Do not
modify those. Extend `User` with the application fields below.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String @id | |
| `username` | String @unique | URL slug for profile; reserved-word checked |
| `email` | String @unique | |
| `name` | String | Display name |
| `profileImage` | String? | URL, not upload |
| `bio` | String? | Max 200 chars |
| `location` | String? | |
| `websiteUrl` | String? | |
| `githubUsername` | String? | |
| `twitterUsername` | String? | |
| `work` | String? | |
| `education` | String? | |
| `skills` | String? | Comma-separated |
| `brandColor` | String | Hex; default `#000000`; drives profile banner |
| `postsCount` | Int @default(0) | Denormalized |
| `createdAt` | DateTime | |

**Reserved usernames** (cannot be registered): `new`, `settings`, `search`, `api`,
`t`, `login`, `signup`, `admin`, `dashboard`, `about`, `terms`, `privacy`.
Enforce at registration. This matters because `/[username]` sits at the root.

### 4.2 Post

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String @id | |
| `userId` | String | FK → User |
| `title` | String | |
| `slug` | String @unique | Generated from title + random suffix |
| `bodyMarkdown` | String @db.Text | Source of truth for content |
| `processedHtml` | String? @db.Text | Rendered by worker; null while processing |
| `coverImage` | String? | URL |
| `description` | String? | First ~140 chars, for cards and meta tags |
| `published` | Boolean @default(false) | |
| `processingState` | Enum | `PENDING` \| `PROCESSING` \| `READY` \| `FAILED` |
| `readingTime` | Int @default(1) | Minutes; computed on process |
| `reactionsCount` | Int @default(0) | Denormalized |
| `commentsCount` | Int @default(0) | Denormalized |
| `viewsCount` | Int @default(0) | Written back from Redis |
| `publishedAt` | DateTime? | |
| `createdAt` / `updatedAt` | DateTime | |

Index on `(published, publishedAt DESC)` — this is the feed query's index.
Index on `slug`.

### 4.3 Tag

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String @id | |
| `name` | String @unique | Lowercase, alphanumeric only |
| `bgColorHex` | String | Tag chip accent |
| `postsCount` | Int @default(0) | Denormalized |

### 4.4 PostTag (join)

`postId`, `tagId`. Compound unique on `(postId, tagId)`.
Maximum 4 tags per post — enforce in application code.

### 4.5 Comment

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String @id | |
| `postId` | String | FK |
| `userId` | String | FK |
| `parentId` | String? | Self-relation; null = top level |
| `bodyMarkdown` | String @db.Text | |
| `processedHtml` | String @db.Text | Comments render synchronously — they're short |
| `depth` | Int @default(0) | Denormalized nesting level |
| `createdAt` | DateTime | |

**Max nesting depth: 3.** Beyond that, replies attach to the depth-3 ancestor.
Fetch a post's entire comment set in one query and assemble the tree in memory —
do not recursively query.

### 4.6 Reaction (polymorphic)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String @id | |
| `userId` | String | FK |
| `reactableId` | String | Post OR Comment id |
| `reactableType` | Enum | `POST` \| `COMMENT` |
| `category` | Enum | `LIKE` \| `UNICORN` \| `BOOKMARK` |

**Compound unique index on `(userId, reactableId, reactableType, category)`.**
This is what prevents double-reacting. Prisma cannot enforce the polymorphic FK —
validate `reactableType` against actual existence in application code.

### 4.7 Follow (polymorphic)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String @id | |
| `followerId` | String | FK → User |
| `followableId` | String | User OR Tag id |
| `followableType` | Enum | `USER` \| `TAG` |

Compound unique on `(followerId, followableId, followableType)`.
One table serves both "follow a person" and "follow a topic".

### 4.8 Notification

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String @id | |
| `userId` | String | Recipient |
| `actorId` | String | Who caused it |
| `type` | Enum | `NEW_REACTION` \| `NEW_COMMENT` \| `NEW_FOLLOWER` |
| `postId` / `commentId` | String? | Context |
| `read` | Boolean @default(false) | |
| `createdAt` | DateTime | |

---

## 5. Feature specifications

### 5.1 Authentication

BetterAuth with email + password. Session-based.

- Sign up collects: email, password, name, username
- Username validated against the reserved list and a `^[a-z0-9_]{3,20}$` pattern
- On first login, redirect to `/settings` to encourage profile completion
- Protected routes: `/new`, `/settings`, and any mutation route handler
- OAuth (GitHub) is a **stretch goal**, not MVP **[OPEN]**

### 5.2 Post editor

The editor is a **plain Markdown textarea with a YAML frontmatter block** — not a
WYSIWYG. This mirrors dev.to and is dramatically simpler to build correctly.

**Layout:** two tabs, `Edit` and `Preview`. Below them, the textarea (or preview
pane). Bottom bar has `Save draft` and `Publish`.

**Document format:**

```
---
title: My post title
published: false
tags: javascript, webdev, tutorial
cover_image: https://example.com/cover.jpg
---

Body content in **Markdown** starts here.
```

**Save behaviour:**
1. Parse frontmatter with `gray-matter`
2. Extract `title`, `published`, `tags` (split on comma, trim, lowercase, max 4), `cover_image`
3. Remaining content becomes `bodyMarkdown`
4. Generate `slug` from title if not already set — slug is immutable after first publish
5. Upsert tags, sync `PostTag` rows
6. Write the Post row with `processingState: PENDING`
7. Enqueue `process-markdown`
8. Return immediately — do not await rendering

**Validation:** title required and ≤ 128 chars; body required; ≤ 4 tags; each tag
`^[a-z0-9]{1,24}$`.

**Preview tab** calls a route handler that runs `lib/markdown.ts` and returns HTML.
Same pipeline as the worker. Debounce 500ms.

**Autosave:** save draft every 30s if content changed. Show a "Saved" timestamp.

### 5.3 Post detail page

Route: `/[username]/[slug]`

Layout (desktop, three columns):

- **Left rail (sticky):** vertical reaction bar — like, unicorn, bookmark — each with count
- **Main column:** cover image → title → author row (avatar, name, published date, reading time) → tag chips → `processedHtml` → comments section
- **Right rail (sticky):** author card with avatar, name, bio, follow button, and their recent posts

Mobile: single column, reaction bar becomes a horizontal sticky footer.

If `processingState !== 'READY'`, render a skeleton with a "Rendering…" note and
poll every 2s. This state is normally sub-second but must be handled.

### 5.4 Feed

Route: `/`

**[DECIDED] Pull-based (read-time) feed generation, not write fan-out.**
Rationale in Section 9.

Query: published posts, ordered by `publishedAt DESC`, paginated 20 per page,
including author, tags, and counts. Cache the result page under
`feed:latest:page:{n}` with a 60-second TTL.

For authenticated users, a second tab "Relevant" ranks by a simple score:

```
score = (reactionsCount * 3) + (commentsCount * 5) + recencyBoost
recencyBoost = max(0, 100 - hoursSincePublished)
```

Posts from followed users or tags get a +50 bonus. Keep this simple and explainable —
it is a talking point, not a research project.

**Post card contents:** cover image (if present), author avatar + name + date, title,
tag chips, reaction count, comment count, reading time.

### 5.5 Profile page

Route: `/[username]`

- Banner strip filled with the user's `brandColor`
- Avatar overlapping the banner edge
- Name, bio
- Metadata row: location, "Joined {month year}", work, education
- Social links: GitHub, Twitter, website
- Follow button (or Edit profile if own profile)
- Stats: post count, comment count
- List of that user's published posts

Settings page at `/settings` edits every User field from Section 4.1.
`profileImage` is a URL input. `brandColor` is a color picker.

### 5.6 Comments

- Threaded to a maximum depth of 3
- Markdown supported, rendered synchronously on submit
- Sorted by `createdAt ASC` within each level
- Author can delete own comment; deletion replaces body with a tombstone rather than
  removing the row, so replies survive
- Each comment shows avatar, name, relative timestamp, body, reply button, reaction count

### 5.7 Reactions

Three categories: `LIKE`, `UNICORN`, `BOOKMARK`. A user may apply each once per post.

Toggle behaviour: clicking an active reaction removes it. Both the Reaction row write
and the `reactionsCount` update happen inside a single `prisma.$transaction`.

Optimistic UI: update the count client-side immediately, roll back on error.

### 5.8 Tags

Route: `/t/[tag]` — posts with that tag, plus a follow button.
Tag chips render as `#tagname` with `bgColorHex` as accent.

### 5.9 Search

PostgreSQL full-text search. Add a `tsvector` column to Post populated from
`title || ' ' || description`, with a GIN index. Do not add Elasticsearch. **[DECIDED]**

Route: `/search?q=` — returns matching posts. Tag and user search are stretch goals.

### 5.10 Notifications

In-app only. Bell icon in the header with an unread count badge.
`/notifications` lists them. Created by the `send-notification` worker job.
Mark-as-read on view.

---

## 6. Architecture

### 6.1 Request flow

```
Client → Next.js (Server Component) → Redis cache?
                                       ├─ hit  → return cached
                                       └─ miss → Prisma → Postgres → cache → return
```

Mutations go through route handlers, which write to Postgres, invalidate the relevant
cache keys, and enqueue any follow-up jobs.

### 6.2 Server vs client components

**Server Components** (default): feed, post detail, profile, tag pages, search results.
These are the cacheable, content-heavy routes.

**Client Components** (`'use client'`): reaction bar, comment form, follow button,
editor, notification bell, theme toggle.

Do not make a route a client component to avoid a data-fetching problem. Push the
interactivity down into a leaf.

### 6.3 Markdown pipeline

Defined once in `lib/markdown.ts`:

```
unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize, schema)
  .use(rehypeHighlight)
  .use(rehypeStringify)
```

**`rehypeSanitize` is mandatory and non-negotiable.** We store HTML and render it
with `dangerouslySetInnerHTML`. Without sanitization this is a stored XSS
vulnerability — any user could publish a post containing a script tag that executes
in every reader's browser.

Reading time: `Math.ceil(wordCount / 265)`, minimum 1.

### 6.4 Caching strategy

Three distinct patterns, deliberately:

| Pattern | Key | Mechanism |
| --- | --- | --- |
| TTL | `feed:latest:page:{n}` | 60s expiry, no invalidation |
| Explicit invalidation | `post:{slug}` | Deleted on post edit, new comment, or render completion |
| Write-behind | `views:post:{id}` | Redis `INCR` on each view; flushed to Postgres every 5 min |

Cache helpers live in `lib/cache.ts`. Every cached value is JSON. Never cache
user-specific data under a shared key.

### 6.5 Background jobs

Queues defined in `lib/queues.ts` with typed payloads. Job payloads carry **IDs only** —
never Prisma objects, since payloads are JSON-serialized and objects go stale.

| Job | Trigger | Does |
| --- | --- | --- |
| `process-markdown` | Post created/updated | Renders HTML, computes reading time, sets `READY`, invalidates `post:{slug}` |
| `reconcile-counters` | Repeatable, every 10 min | Recomputes true reaction/comment counts, corrects drift |
| `flush-view-counts` | Repeatable, every 5 min | Drains Redis view counters into Postgres |
| `send-notification` | Reaction / comment / follow | Creates Notification row |

Every queue is configured with `removeOnComplete: { count: 100 }` and
`removeOnFail: { count: 500 }` or Redis fills with completed job records in development.

Retries: 3 attempts, exponential backoff. On final failure, `process-markdown`
sets `processingState: FAILED` so the UI can show an error rather than spinning.

Bull Board mounts on a separate dev port for the live demo.

---

## 8. Design system

The visual language follows **Crayons**, Forem's design system. Two reference sources:

- **Live component reference:** https://storybook.forem.com/
- **Token source:** `app/assets/stylesheets/variables.scss` in the Forem repo

### 8.1 How to populate this section

Do not guess values. Open the Storybook, inspect the rendered components, and fill
the placeholders below with verified values. Then define them once as CSS custom
properties in `globals.css` and map them into `tailwind.config.ts` so Tailwind
utilities resolve to the tokens rather than to Tailwind's defaults.

### 8.2 Typography

Crayons uses a **system font stack** for UI text — this is why dev.to feels native
on every OS and why it costs nothing to reproduce. Do not load a webfont for body text.

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
--font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
```

Type scale (fill from Storybook):

| Token | Size | Weight | Used for |
| --- | --- | --- | --- |
| `--fs-s` | | 400 | Meta text, timestamps |
| `--fs-base` | | 400 | Body |
| `--fs-l` | | 500 | Card titles |
| `--fs-xl` | | 700 | Section headings |
| `--fs-2xl` | | 700 | Post titles |
| `--fs-3xl` | | 800 | Page titles |

Post body line-height should be noticeably generous (~1.6–1.7). Long-form readability
is the entire point of the product.

### 8.3 Color

Crayons is organized around **semantic** tokens that resolve differently in light and
dark mode, layered over a base palette. Structure the tokens the same way:

```css
:root {
  --base-bg:        /* page background */
  --body-bg:        /* card / elevated surface */
  --body-color:     /* primary text */
  --color-secondary:/* muted text */
  --border-color:   /* hairlines */
  --accent-brand:   /* primary action */
  --accent-success:
  --accent-danger:
  --accent-warning:
}

[data-theme="dark"] { /* same names, dark values */ }
```

**Every color in the app must go through a semantic token.** No hardcoded hex in
components — that is what breaks dark mode.

Dark mode is toggled via a `data-theme` attribute on `<html>`, persisted in a cookie
so the server render matches and there is no flash.

### 8.4 Spacing

Crayons uses a numbered spacing scale. Map it onto Tailwind's spacing config so
`p-4` resolves to the token rather than Tailwind's default.

| Token | Value |
| --- | --- |
| `--su-1` | 4px |
| `--su-2` | 8px |
| `--su-3` | 12px |
| `--su-4` | 16px |
| `--su-5` | 24px |
| `--su-6` | 32px |
| `--su-7` | 48px |

### 8.5 Radius and elevation

| Token | Value |
| --- | --- |
| `--radius` | 4px |
| `--radius-large` | 8px |

Cards use a **1px border, not a shadow**, in the default state. This is a
characteristic detail of the dev.to look — the interface reads as flat and
document-like rather than floating. Shadows appear only on hover and on dropdowns.

### 8.6 Layout

| Breakpoint | Layout |
| --- | --- |
| `< 640px` | Single column, no rails |
| `640–1024px` | Main column + right rail |
| `> 1024px` | Left rail + main column + right rail |

Max content width ~1280px, centered. Feed cards are full-width within the main column.
Header is sticky, full-width, with a bottom border.

### 8.7 Core components to build

Build these as primitives in `/components/ui` before building any page:

`Button` (primary / secondary / outline / ghost, three sizes) · `Card` ·
`Avatar` (four sizes, circular) · `Tag` chip · `Input` · `Textarea` · `Select` ·
`Dropdown` · `Modal` · `Tabs` · `Toast` · `Skeleton` · `EmptyState`

### 8.8 Copy conventions

- Sentence case for all UI text. Never Title Case.
- Buttons name the action and keep the name through the flow: a `Publish` button
  produces a "Published" toast.
- Errors state what happened and what to do about it. They do not apologize and
  they are never vague.
- Empty states are invitations to act, not dead ends: "No posts yet — write your first one."

---

## 9. Architectural decisions to defend

These are the three decisions worth being able to explain in the viva. Each one has
a real tradeoff, which is what makes it worth discussing.

### 9.1 Process Markdown on write, not on read

**Decision:** Convert Markdown to sanitized HTML once at publish time and store both
`bodyMarkdown` and `processedHtml`.

**Alternative rejected:** Render on every page view.

**Why:** Parsing, sanitizing, and syntax-highlighting a long article is expensive and
completely deterministic. A popular post might be read 10,000 times and edited twice —
rendering on read does the same work 10,000 times for an identical result. Storage is
cheaper than CPU.

**Tradeoff acknowledged:** Changing the rendering pipeline (adding a plugin, changing
the sanitizer schema) requires re-processing every existing post via a backfill job.

### 9.2 Pull-based feed, not write fan-out

**Decision:** Generate the feed by querying at read time and caching the result.

**Alternative rejected:** Write fan-out — pushing each new post into a precomputed
per-user feed list on publish.

**Why:** Write fan-out exists to solve a problem we do not have. Twitter needs it
because feeds are *private and personalized* — there is no shared artifact to cache.
build.to's content is *public*, so one cached feed page serves every anonymous visitor
and most logged-in ones. Fan-out would also create a write amplification problem: a
user with 10,000 followers triggers 10,000 writes on every publish.

**Tradeoff acknowledged:** Heavily personalized ranking gets expensive at read time.
At a scale where per-user ranking becomes complex, a hybrid (fan-out for high-follower
accounts, pull for the rest) is the standard answer.

### 9.3 Denormalized counters with background reconciliation

**Decision:** Store `reactionsCount` and `commentsCount` as integer columns, updated
transactionally, and run a periodic job that recomputes the true value and corrects drift.

**Alternative rejected:** `COUNT(*)` on every render.

**Why:** The feed shows 20 posts; counting reactions per post per render means 40
aggregate queries for one page load. An integer read is free.

**Tradeoff acknowledged:** The counter is a cache and can drift — from a failed
transaction, a manual DB edit, or a bug. Rather than pretending it cannot, the design
assumes drift and repairs it on a schedule. This is the "fast path may lie, slow path
tells the truth" pattern.

**Demo:** Corrupt a counter in psql, wait for the job, watch it heal. This is the
single most convincing thing in the presentation.

---

## 10. Build order

Do not start a phase before the previous one works end to end.

### Phase 1 — Foundation
Next.js + TypeScript + Tailwind scaffold · Prisma schema and first migration ·
Postgres and Redis running locally · BetterAuth wired up, sign up and log in working ·
design tokens in `globals.css` and `tailwind.config.ts` · UI primitives from 8.7
**Done when:** a user can register, log in, and see an empty authenticated shell.

### Phase 2 — The core loop
Post editor with frontmatter parsing · Markdown pipeline in `lib/markdown.ts` ·
Preview tab · Post detail page · slug generation
**Done when:** a user can write, publish, and read back a rendered post.
*Render synchronously in this phase. The worker comes in Phase 4.*

### Phase 3 — Content graph
Tags and PostTag · tag pages · home feed with pagination · post cards · search
**Done when:** posts are discoverable without knowing the URL.

### Phase 4 — Async
Worker process bootstrap · `process-markdown` moved off the request path ·
`processingState` handling in the UI · Bull Board
**Done when:** publishing returns instantly and the dashboard shows the job running.

### Phase 5 — Social
Reactions with transactional counters · threaded comments · follows ·
`reconcile-counters` job · notifications
**Done when:** two seeded users can interact with each other's posts.

### Phase 6 — Profiles
Profile page · settings page · brand color banner
**Done when:** a profile is presentable as a portfolio page.

### Phase 7 — Performance layer
Redis caching for feed and post pages · invalidation on write ·
view counting with `flush-view-counts`
**Done when:** you can demonstrate a measurable before/after.

*Layer caching last, deliberately — you want a working baseline to compare against.*

### Phase 8 — Polish
Dark mode · responsive passes · empty states · error states · loading skeletons ·
seed script with realistic data
**Done when:** the demo does not require apologizing for anything.

---

## 11. Seed data

`prisma/seed.ts` must generate a demo-ready state: ~8 users with filled profiles
and distinct brand colors, ~25 published posts with real Markdown (code blocks,
headings, lists, links), ~12 tags, threaded comments at depths 1–3, and a spread
of reactions. A demo against an empty database is not a demo.

---

## 12. Open questions

| # | Question | Status |
| --- | --- | --- |
| 1 | GitHub OAuth in addition to email/password? | **[OPEN]** — stretch |
| 2 | Series / multi-part posts? | **[OPEN]** — likely cut |
| 3 | Separate Redis instances for cache and queue? | **[DECIDED]** — one instance in dev, note the production caveat in the presentation |
| 4 | Post edit history? | **[DECIDED]** — no |
| 5 | Rate limiting on writes? | **[OPEN]** — nice-to-have |

---

## Appendix A — Reference material

- Forem source: https://github.com/forem/forem (AGPL-3.0)
- Forem developer docs: https://developers.forem.com/
- Crayons Storybook: https://storybook.forem.com/
- Forem SASS variables: `app/assets/stylesheets/variables.scss`
- Forem architecture overview: https://developers.forem.com/technical-overview/stack

Files worth reading in the Forem repo for schema and pattern reference:
`app/models/article.rb`, `app/models/reaction.rb`, `app/models/comment.rb`,
and `db/schema.rb`.

**Note on licensing:** Forem is AGPL-3.0. This project reads Forem as a reference for
architecture and UI conventions but does not copy its source code. All build.to code
is independently written in a different language and framework, under its own name
and branding.