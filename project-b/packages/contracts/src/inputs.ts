import { z } from "zod";
import { MilestoneStatus, ProjectRole, ProjectStage, TaskPriority, TaskStatus, Visibility } from "./enums.ts";

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
// BetterAuth IDs from Project A are opaque strings, not necessarily UUIDs.
export const UserId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Must be a valid http(s) URL");

const optionalUrl = z
  .union([httpUrl, z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** A real calendar date: "2026-02-31" and "2026-13-01" are rejected, not rolled over. */
export const IsoDate = z.iso.date({ message: "Expected a valid date (YYYY-MM-DD)" });

export const RESERVED_USERNAMES = new Set([
  "api", "app", "admin", "auth", "login", "logout", "signup", "home", "new", "discover", "explore",
  "inbox", "settings", "projects", "privacy", "terms", "about", "help", "support", "docs", "blog",
  "status", "security", "pricing", "legal", "static", "assets", "_next", "favicon.ico", "robots.txt",
  "sitemap.xml", "invite", "invites", "u", "p", "me", "bldt", "github", "webhooks", "search", "verify", ".well-known", "device",
  // Top-level files and folders served by the web app.
  "apple-icon", "icon", "opengraph-image", "downloads", "manifest", "realtime", "onboarding", "notifications", "drafts", "edit", "t", "dashboard",
]);

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers, and underscores only")
  .refine((v) => !RESERVED_USERNAMES.has(v), "This username is reserved");

export const ProjectSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Letters, numbers, dots, hyphens, and underscores only");

export const ProjectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "2 to 10 characters, starting with a letter");

export const UpdateProfileInput = z.object({
  displayName: trimmed(1, 80).optional(),
  username: Username.optional(),
  headline: optionalText(120),
  bio: optionalText(200),
  location: optionalText(80),
  websiteUrl: optionalUrl,
  focusAreas: z.array(trimmed(1, 32)).max(6).optional(),
  openToWork: z.boolean().optional(),
  /** Personal meeting room for huddles. https only. */
  meetingUrl: z.url().max(500).refine((u) => u.startsWith("https://"), "Must start with https://").nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const CreateProjectInput = z.object({
  name: trimmed(1, 80),
  slug: ProjectSlug.optional(),
  key: ProjectKey.optional(),
  tagline: optionalText(160),
  stage: ProjectStage.default("BUILDING"),
  visibility: Visibility.default("PRIVATE"),
  /** GitHub repository ids to connect; the first becomes primary. */
  repositoryGithubIds: z.array(z.coerce.number().int().positive()).max(10).default([]),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = z.object({
  name: trimmed(1, 80).optional(),
  slug: ProjectSlug.optional(),
  tagline: optionalText(160),
  description: optionalText(20000),
  visibility: Visibility.optional(),
  homepageUrl: optionalUrl,
  openToContributors: z.boolean().optional(),
  lookingFor: z.array(trimmed(1, 40)).max(8).optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

export const ChangeStageInput = z.object({
  stage: ProjectStage,
  /** Recorded when moving to PAUSED or SUNSET. */
  retrospective: optionalText(4000),
});
export type ChangeStageInput = z.infer<typeof ChangeStageInput>;

export const ShipInput = z.object({
  title: trimmed(1, 120),
  version: optionalText(40),
  notes: optionalText(20000),
  url: optionalUrl,
});
export type ShipInput = z.infer<typeof ShipInput>;

export const CreateTaskInput = z.object({
  title: trimmed(1, 200),
  description: optionalText(20000),
  status: TaskStatus.default("TODO"),
  priority: TaskPriority.default("NONE"),
  assigneeId: UserId.nullable().optional(),
  milestoneId: z.uuid().nullable().optional(),
  dueOn: IsoDate.nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const UpdateTaskInput = z.object({
  title: trimmed(1, 200).optional(),
  description: optionalText(20000),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  assigneeId: UserId.nullable().optional(),
  milestoneId: z.uuid().nullable().optional(),
  dueOn: IsoDate.nullable().optional(),
  /** Place the task between two neighbours in its column. Both null means end of column. */
  move: z
    .object({ beforeId: z.uuid().nullable(), afterId: z.uuid().nullable() })
    .optional(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

export const TaskListQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : undefined))
    .pipe(z.array(TaskStatus).optional()),
  assignee: z.union([z.literal("me"), z.literal("none"), UserId]).optional(),
  milestone: z.union([z.literal("none"), z.uuid()]).optional(),
  q: z.string().trim().max(100).optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuery>;

export const CreateMilestoneInput = z.object({
  title: trimmed(1, 120),
  description: optionalText(4000),
  dueOn: IsoDate.nullable().optional(),
  status: MilestoneStatus.default("PLANNED"),
});
export type CreateMilestoneInput = z.infer<typeof CreateMilestoneInput>;

// Explicit, not CreateMilestoneInput.partial(): in Zod 4 partial() keeps defaults, so an edit
// without a status would silently reset it to PLANNED.
export const UpdateMilestoneInput = z.object({
  title: trimmed(1, 120).optional(),
  description: optionalText(4000),
  dueOn: IsoDate.nullable().optional(),
  status: MilestoneStatus.optional(),
});
export type UpdateMilestoneInput = z.infer<typeof UpdateMilestoneInput>;

export const CreateCommentInput = z.object({
  body: trimmed(1, 10000),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

export const InviteInput = z.object({
  username: Username,
  role: ProjectRole.exclude(["OWNER"]).default("CONTRIBUTOR"),
});
export type InviteInput = z.infer<typeof InviteInput>;

export const UpdateMemberInput = z.object({
  role: ProjectRole.exclude(["OWNER"]).optional(),
  title: optionalText(60),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>;

export const UpdateMyMembershipInput = z.object({
  showOnProfile: z.boolean().optional(),
  profileOrder: z.number().int().min(0).max(1000).nullable().optional(),
});
export type UpdateMyMembershipInput = z.infer<typeof UpdateMyMembershipInput>;

export const JoinRequestInput = z.object({
  message: trimmed(10, 1000),
  roleWanted: optionalText(40),
});
export type JoinRequestInput = z.infer<typeof JoinRequestInput>;

export const DecideInput = z.object({
  decision: z.enum(["APPROVE", "DECLINE"]),
  role: ProjectRole.exclude(["OWNER"]).default("CONTRIBUTOR"),
});
export type DecideInput = z.infer<typeof DecideInput>;

export const RespondInviteInput = z.object({
  accept: z.boolean(),
});
export type RespondInviteInput = z.infer<typeof RespondInviteInput>;

export const ConnectRepositoriesInput = z.object({
  repositoryGithubIds: z.array(z.coerce.number().int().positive()).min(1).max(10),
});
export type ConnectRepositoriesInput = z.infer<typeof ConnectRepositoriesInput>;

export const UpdateTechnologiesInput = z.object({
  add: z.array(z.string().max(40)).max(20).default([]),
  hide: z.array(z.string().max(40)).max(50).default([]),
  unhide: z.array(z.string().max(40)).max(50).default([]),
});
export type UpdateTechnologiesInput = z.infer<typeof UpdateTechnologiesInput>;

export const CursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

export const DiscoverQuery = CursorQuery.extend({
  q: z.string().trim().max(100).optional(),
  tech: z.string().max(40).optional(),
  stage: ProjectStage.optional(),
  open: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  sort: z.enum(["recent", "shipped"]).default("recent"),
});
export type DiscoverQuery = z.infer<typeof DiscoverQuery>;

export const PeopleQuery = CursorQuery.extend({
  q: z.string().trim().max(100).optional(),
  tech: z.string().max(40).optional(),
  open: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});
export type PeopleQuery = z.infer<typeof PeopleQuery>;

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

// ── Outbound webhooks ────────────────────────────────────────

export const WEBHOOK_CATEGORIES = ["task", "milestone", "release", "project", "member", "pull_request", "push", "deployment", "signal"] as const;
export type WebhookCategory = (typeof WEBHOOK_CATEGORIES)[number];
export const WEBHOOK_FORMATS = ["JSON", "SLACK", "DISCORD"] as const;

export const CreateWebhookInput = z.object({
  url: z.string().trim().min(1).max(2048),
  format: z.enum(WEBHOOK_FORMATS).default("JSON"),
  description: z.string().trim().max(200).optional(),
  /** Empty: every category. */
  events: z.array(z.enum(WEBHOOK_CATEGORIES)).max(WEBHOOK_CATEGORIES.length).default([]),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInput>;

export const UpdateWebhookInput = z.object({
  url: z.string().trim().min(1).max(2048).optional(),
  format: z.enum(WEBHOOK_FORMATS).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_CATEGORIES)).max(WEBHOOK_CATEGORIES.length).optional(),
  active: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookInput>;

// ── Discussions ──────────────────────────────────────────────

export const DISCUSSION_CATEGORIES = ["GENERAL", "HELP", "IDEAS", "ANNOUNCEMENTS"] as const;
export type DiscussionCategory = (typeof DISCUSSION_CATEGORIES)[number];

/** What the editor captures with "Ask the team". Every field is optional except the error itself. */
/**
 * A path inside the repository: forward slashes, no drive letters, no leading slash or ~, and no
 * ".." segments, so a stored path can never point outside the repository or reveal a home directory.
 */
const RepoRelativePath = z
  .string()
  .trim()
  .max(500)
  .transform((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""))
  .refine((p) => p.length > 0 && !/^([a-zA-Z]:|\/|~)/.test(p) && !p.split("/").includes(".."), "Use a path relative to the repository");

export const ErrorContextInput = z.object({
  errorMessage: z.string().trim().min(1).max(20_000),
  language: z.string().trim().max(40).optional(),
  /** Workspace-relative path; absolute paths are rejected so home directories never leak. */
  filePath: RepoRelativePath.optional(),
  line: z.number().int().min(1).max(10_000_000).optional(),
  codeSnippet: z.string().max(5_000).optional(),
  branch: z.string().trim().max(200).optional(),
  commitSha: z.string().trim().regex(/^[0-9a-f]{7,40}$/i).optional(),
});
export type ErrorContextInput = z.infer<typeof ErrorContextInput>;

export const CreateDiscussionInput = z
  .object({
    category: z.enum(DISCUSSION_CATEGORIES).default("GENERAL"),
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().max(20_000).default(""),
    error: ErrorContextInput.optional(),
  })
  .refine((d) => d.body.length > 0 || d.error, { message: "Write something, or include the error", path: ["body"] })
  .refine((d) => !d.error || d.category === "HELP", { message: "Only help threads carry an error", path: ["category"] });
export type CreateDiscussionInput = z.infer<typeof CreateDiscussionInput>;

export const UpdateDiscussionInput = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  body: z.string().trim().max(20_000).optional(),
  category: z.enum(DISCUSSION_CATEGORIES).optional(),
  pinned: z.boolean().optional(),
  locked: z.boolean().optional(),
});
export type UpdateDiscussionInput = z.infer<typeof UpdateDiscussionInput>;

export const DiscussionReplyInput = z.object({ body: z.string().trim().min(1).max(20_000) });

// ── Presence and huddles ─────────────────────────────────────

/** Editor heartbeat. Sent about every 30 seconds while the editor is focused or active. */
export const PresenceInput = z.object({
  owner: z.string().min(1).max(39),
  slug: z.string().min(1).max(64),
  state: z.enum(["active", "idle"]).default("active"),
  branch: z.string().trim().max(200).optional(),
  /** Workspace-relative; only sent when the person chose to share files. */
  filePath: RepoRelativePath.optional(),
  taskNumber: z.number().int().min(1).optional(),
  client: z.string().trim().max(40).default("vscode"),
});
export type PresenceInput = z.infer<typeof PresenceInput>;

export const StartHuddleInput = z.object({
  kind: z.enum(["HUDDLE", "PAIR"]).default("HUDDLE"),
  /** Members to invite; empty invites everyone online in the project. */
  invitees: z.array(UserId).max(50).default([]),
  topic: z.string().trim().max(120).optional(),
  /** PAIR: the Live Share link the editor created. HUDDLE: optional override of the meeting link. */
  url: z.url().max(1000).optional(),
});
export type StartHuddleInput = z.infer<typeof StartHuddleInput>;

export const SEARCH_TYPES = ["tasks", "discussions", "pull_requests", "releases"] as const;
export const FullSearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(SEARCH_TYPES).optional(),
  /** Restrict to one project, as owner/slug. */
  project: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
  page: z.coerce.number().int().min(1).max(10).default(1),
});
export type FullSearchQuery = z.infer<typeof FullSearchQuery>;
