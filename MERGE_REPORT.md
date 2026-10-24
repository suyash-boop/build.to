# Project A + B integration — 23 October 2026

## Delivered

- A remains the main community/publishing interface at `/`.
- B is the Projects workspace under `/projects`, reachable from A's header,
  feed, account menu, settings, profiles, and notifications.
- One PostgreSQL database and one canonical `user` row per person. BetterAuth
  in A verifies browser sessions for both apps. No second B browser login.
- Shared name/avatar/profile fields and light/dark preference; project cards on
  community profiles respect project visibility and membership.
- B's workspace uses matching warm surfaces, indigo actions, updated navigation,
  a clearer overview, and responsive layouts. Its API and workers are retained.
- Root npm workspaces, lockfile, migration history, combined launchers and checks.

## Existing database

Applied additive migration `20261023180000_merge_project_workspace` to the existing
`buildto` database. Counts before and after: **3 users, 3 posts, 4 comments**.
The technology catalog was upserted (92 entries); content was not reset.
Existing user IDs and article/comment records were retained.

Pre-migration PostgreSQL custom-format backup (38,730 bytes):

```text
C:\Users\Suyash\AppData\Local\Temp\opencode\buildto-before-merge-20261023.dump
```

Copy this backup to durable storage before clearing temporary files. The original
`bld.to.zip` is untouched and excluded from Git; the extracted source is versioned.

## Validation

- Production builds: A, B web, B API, B worker.
- Typecheck: root, all workspaces and integration/browser test code.
- Root lint and 155 unit/structural checks.
- 11 isolated PostgreSQL/BetterAuth integration checks: real signed sessions,
  forged-session rejection, text IDs, visibility, invitations, notifications,
  separate comment domains, two-way profiles, search, CSRF and shared sign-out.
- Real Edge browser checks: cross-zone identity, project/task creation, profile
  edits, shared theme, mobile fit and sign-out; no browser exceptions.
- Production dependency audit: zero reported vulnerabilities. Full audit retains
  one low-severity development-only esbuild advisory in B's build tooling.
- Root lockfile dry-run install succeeds.

Screenshots are outside the repository:

```text
C:\Users\Suyash\AppData\Local\Temp\opencode\buildto-merge-screenshots
```

## Run and remaining setup

Run `npm run dev`, open `http://localhost:3000`, and choose **Projects**.
See `README.md` for deployment and isolated-test commands.

GitHub App sync, AI, and signed work records need their optional credentials;
live external-service flows were not validated without those credentials.
Manual projects and collaboration do not require them.

The supplied ZIP contains source and migrations, **not a live database export**.
B's schema is merged into A's database; any existing rows from a separate B
deployment still require an export and an explicit identity-matching import.
Do not run reset/legacy seed commands or B's archived migrations against A's DB.

## Development follow-up — 24 October 2026

A React development warning about a previous `use()` suspension was reported
during workspace navigation. Read-only browser checks against the running local
development stack covered Overview, Tasks, Settings, Milestones, delayed RSC
requests, browser history, and hard reload without reproducing the warning.
Its cause is not confirmed; it should not be treated as fixed. The browser smoke
test now also captures React suspension/hydration errors reported through the
console, rather than checking only thrown browser exceptions.
