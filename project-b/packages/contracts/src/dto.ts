import type {
  DeploymentState,
  MilestoneStatus,
  ProjectRole,
  ProjectStage,
  SyncStatus,
  TaskPriority,
  TaskStatus,
  TechCategory,
  TrustLevel,
  Visibility,
} from "./enums.ts";
import type { ProjectAction } from "./permissions.ts";

/** All timestamps are ISO-8601 strings; calendar dates are YYYY-MM-DD. */
type Iso = string;

export interface UserRef {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Me extends UserRef {
  email: string | null;
  headline: string | null;
  bio: string | null;
  location: string | null;
  websiteUrl: string | null;
  focusAreas: string[];
  openToWork: boolean;
  githubLogin: string | null;
  createdAt: Iso;
  unreadNotifications: number;
  meetingUrl: string | null;
  features: { ai: boolean; githubApp?: boolean };
}

export interface TechnologyRef {
  slug: string;
  name: string;
  category: TechCategory;
  color: string | null;
}

export interface ProjectTech extends TechnologyRef {
  source: "DETECTED" | "MANUAL";
  share: number;
  evidence: string | null;
  hidden: boolean;
}

export interface RepositorySummary {
  id: string;
  githubId: number;
  fullName: string;
  htmlUrl: string;
  isPrivate: boolean;
  isPrimary: boolean;
  defaultBranch: string;
  primaryLanguage: string | null;
  stars: number;
  pushedAt: Iso | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: Iso | null;
}

export interface ProjectCard {
  id: string;
  owner: UserRef;
  slug: string;
  key: string;
  name: string;
  tagline: string | null;
  stage: ProjectStage;
  visibility: Visibility;
  homepageUrl: string | null;
  openToContributors: boolean;
  lookingFor: string[];
  technologies: TechnologyRef[];
  memberCount: number;
  members: UserRef[];
  shippedAt: Iso | null;
  updatedAt: Iso;
}

export interface ProjectDetail extends ProjectCard {
  description: string | null;
  retrospective: string | null;
  sunsetAt: Iso | null;
  createdAt: Iso;
  repositories: RepositorySummary[];
  readme: string | null;
  allTechnologies: ProjectTech[];
  viewer: {
    role: ProjectRole | null;
    permissions: ProjectAction[];
    pendingJoinRequest: boolean;
    pendingInvitationId: string | null;
  };
  stats: {
    openTasks: number;
    doneTasks: number;
    releases: number;
    contributors: number;
    mergedPrs: number;
  };
  activeMilestone: MilestoneSummary | null;
  latestDeployments: DeploymentSummary[];
}

/** Generated status brief. References are task ids or #PR numbers verified to exist in the project. */
export interface ProjectBriefItem {
  summary: string;
  recent: { text: string; refs: string[] }[];
  next: { text: string; refs: string[] }[];
  risks: { text: string; refs: string[] }[];
  generatedAt: Iso;
  generatedBy: UserRef | null;
  model: string;
}

export interface MilestoneSummary {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  dueOn: string | null;
  completedAt: Iso | null;
  position: number;
  taskCounts: { total: number; done: number };
}

export interface LinkedPullRequest {
  number: number;
  title: string;
  htmlUrl: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  repoFullName: string;
  authorLogin: string;
  closes: boolean;
}

export interface TaskSummary {
  id: string;
  number: number;
  identifier: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  assignee: UserRef | null;
  milestone: { id: string; title: string } | null;
  dueOn: string | null;
  prCount: number;
  commentCount: number;
  createdAt: Iso;
  updatedAt: Iso;
  completedAt: Iso | null;
  /** Mirrors a GitHub issue: title, body, and open/closed follow GitHub. */
  github: { number: number; url: string } | null;
}

export interface TaskDetail extends TaskSummary {
  description: string | null;
  creator: UserRef;
  startedAt: Iso | null;
  pullRequests: LinkedPullRequest[];
  comments: CommentItem[];
  history: ActivityItem[];
}

export interface CommentItem {
  id: string;
  author: UserRef;
  body: string;
  createdAt: Iso;
  editedAt: Iso | null;
}

export interface MemberItem {
  user: UserRef;
  role: ProjectRole;
  title: string | null;
  joinedAt: Iso;
  contribution: ContributionStats | null;
}

export interface ContributionStats {
  commits: number;
  additions: number;
  deletions: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  firstAt: Iso | null;
  lastAt: Iso | null;
}

export interface InvitationItem {
  id: string;
  project: { id: string; name: string; slug: string; owner: UserRef };
  inviter: UserRef;
  invitee: UserRef | null;
  role: ProjectRole;
  status: string;
  expiresAt: Iso;
  createdAt: Iso;
}

export interface JoinRequestItem {
  id: string;
  user: UserRef;
  message: string;
  roleWanted: string | null;
  status: string;
  createdAt: Iso;
}

export interface ReleaseItem {
  id: string;
  version: string | null;
  title: string;
  notes: string | null;
  url: string | null;
  commitSha: string | null;
  source: "MANUAL" | "GITHUB_RELEASE" | "DEPLOYMENT";
  isShip: boolean;
  createdBy: UserRef | null;
  shippedAt: Iso;
}

export interface DeploymentSummary {
  id: string;
  environment: string;
  state: DeploymentState;
  url: string | null;
  sha: string;
  ref: string;
  createdAt: Iso;
  updatedAt: Iso;
}

/**
 * Normalized activity. `type` values:
 * project.created, project.stage_changed, project.shipped, member.joined, member.left,
 * task.created, task.completed, task.status_changed, milestone.completed,
 * github.push, github.pr_opened, github.pr_merged, github.pr_closed, github.review,
 * github.release, github.deployment
 */
export interface ActivityItem {
  id: string;
  type: string;
  source: "BLDT" | "GITHUB";
  trust: TrustLevel;
  actor: UserRef | null;
  actorLogin: string | null;
  project: { id: string; name: string; slug: string; ownerUsername: string } | null;
  payload: Record<string, unknown>;
  occurredAt: Iso;
}

export interface NotificationItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
  readAt: Iso | null;
  createdAt: Iso;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ProfileProject extends ProjectCard {
  role: ProjectRole;
  title: string | null;
  contribution: ContributionStats | null;
  releases: number;
}

export interface ProfileTech extends TechnologyRef {
  /** Projects this person is on that use the technology. */
  projects: number;
  /** True when at least one of those projects has connected GitHub contribution evidence from this person. */
  evidenced: boolean;
}

export interface BuildHistoryEntry {
  id: string;
  kind: "shipped" | "release" | "joined" | "started" | "sunset";
  project: { name: string; slug: string; ownerUsername: string };
  title: string;
  version: string | null;
  url: string | null;
  trust: TrustLevel;
  occurredAt: Iso;
}

export interface PublicProfile extends UserRef {
  headline: string | null;
  bio: string | null;
  location: string | null;
  websiteUrl: string | null;
  focusAreas: string[];
  openToWork: boolean;
  githubLogin: string | null;
  joinedAt: Iso;
  summary: {
    shipped: number;
    building: number;
    collaborators: number;
    mergedPrs: number;
    reviews: number;
    /** Work on projects the viewer cannot see, counted but never named. */
    privateProjects: number;
    privateMergedPrs: number;
  };
  technologies: ProfileTech[];
  projects: ProfileProject[];
  history: BuildHistoryEntry[];
  isSelf: boolean;
}

export interface HomeData {
  activeProjects: (ProjectCard & { role: ProjectRole; openTasks: number; myOpenTasks: number })[];
  myTasks: (TaskSummary & { project: { name: string; slug: string; ownerUsername: string; key: string } })[];
  attention: {
    invitations: InvitationItem[];
    joinRequests: (JoinRequestItem & { project: { name: string; slug: string; ownerUsername: string } })[];
    failingDeployments: (DeploymentSummary & { project: { name: string; slug: string; ownerUsername: string } })[];
    failedSyncs: { repository: string; error: string | null; project: { name: string; slug: string; ownerUsername: string } }[];
    overdueMilestones: (MilestoneSummary & { project: { name: string; slug: string; ownerUsername: string } })[];
  };
  activity: ActivityItem[];
  signals: SignalItem[];
}

export interface GithubInstallationItem {
  id: number;
  accountLogin: string;
  accountType: string;
  repoSelection: string;
  manageUrl: string;
}

export interface ImportableRepository {
  githubId: number;
  fullName: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  primaryLanguage: string | null;
  stars: number;
  pushedAt: Iso | null;
  installationId: number;
  /** Already connected to one of the viewer's projects. */
  connectedTo: { name: string; slug: string; ownerUsername: string } | null;
}

export interface SearchResults {
  projects: { name: string; slug: string; ownerUsername: string; stage: ProjectStage; isMember: boolean }[];
  tasks: { identifier: string; number: number; title: string; status: TaskStatus; project: { slug: string; ownerUsername: string; name: string } }[];
  discussions: { number: number; title: string; category: "GENERAL" | "HELP" | "IDEAS" | "ANNOUNCEMENTS"; solved: boolean; project: { name: string; slug: string; ownerUsername: string } }[];
  people: UserRef[];
}

export type SignalSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface SignalItem {
  id: string;
  type: string;
  severity: SignalSeverity;
  title: string;
  data: Record<string, unknown>;
  firstSeenAt: Iso;
  lastSeenAt: Iso;
  snoozedUntil: Iso | null;
  project: { name: string; slug: string; ownerUsername: string };
}

export interface SignalSettingsDto {
  stalledDays: number;
  reviewHours: number;
  wipLimit: number;
  atRiskBelow: number;
  disabled: string[];
}

export interface DurationStats {
  count: number;
  /** Hours. */
  p50: number | null;
  p85: number | null;
}

export interface MilestoneForecast {
  milestone: { id: string; title: string; dueOn: string | null; status: MilestoneStatus };
  remaining: number;
  done: number;
  p50: string | null;
  p85: string | null;
  p95: string | null;
  onTimeProbability: number | null;
  reason: "done" | "no_history" | "no_throughput" | null;
}

export interface AgingItem {
  number: number;
  identifier: string;
  title: string;
  status: TaskStatus;
  assignee: UserRef | null;
  ageDays: number;
  /** Older than 85% of recently completed work's cycle time. */
  stale: boolean;
}

export interface ProjectInsights {
  windowDays: number;
  generatedAt: Iso;
  tasks: {
    completed: number;
    created: number;
    cycleTime: DurationStats;
    leadTime: DurationStats;
    /** Completed per week, oldest first, 12 weeks. */
    throughput: { weekStart: string; count: number }[];
    wip: number;
    aging: AgingItem[];
    byPriority: { priority: TaskPriority; completed: number; p50CycleHours: number | null }[];
  };
  pullRequests: {
    merged: number;
    timeToMerge: DurationStats;
    timeToFirstReview: DurationStats;
    medianSize: number | null;
    unlinkedMerged: number;
    mergedPerWeek: { weekStart: string; count: number }[];
  } | null;
  burnup: { date: string; scope: number; done: number }[];
  forecasts: MilestoneForecast[];
  contributors: { user: UserRef; completed: number; prsMerged: number; reviews: number }[];
}

/** A technology someone uses, from their public projects; `evidenced` means their own commits or merged PRs back it. */
export interface PersonTech extends TechnologyRef {
  projects: number;
  evidenced: boolean;
}

export interface PersonCard extends UserRef {
  headline: string | null;
  location: string | null;
  openToWork: boolean;
  focusAreas: string[];
  technologies: PersonTech[];
  publicProjects: number;
  shipped: number;
  mergedPrs: number;
}

/** Why a match was suggested, so the UI can explain it instead of showing an opaque score. */
export interface MatchReason {
  technologies: TechnologyRef[];
  /** Of those, how many are backed by the person's own GitHub evidence. */
  evidenced: number;
}

export interface SuggestedProject extends ProjectCard {
  reason: MatchReason;
}

export interface SuggestedPerson extends PersonCard {
  reason: MatchReason;
}

export interface SidebarProject {
  id: string;
  name: string;
  slug: string;
  key: string;
  stage: ProjectStage;
  ownerUsername: string;
  role: ProjectRole;
  visibility: Visibility;
  showOnProfile: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** A live-update hint from GET /realtime. Never carries row data; the client refetches. */
export type RealtimeChange =
  | { k: "task" | "comment" | "milestone" | "activity" | "signal" | "discussion" | "presence" | "member" | "project"; project: { owner: string; slug: string } }
  | { k: "notification" | "projects" | "resync" };

export interface WebhookEndpointItem {
  id: string;
  url: string;
  format: "JSON" | "SLACK" | "DISCORD";
  description: string | null;
  events: string[];
  active: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: Iso | null;
  lastSuccessAt: Iso | null;
  createdAt: Iso;
  createdBy: UserRef | null;
  /** Deliveries in the last 24 hours. */
  recent: { total: number; failed: number; pending: number };
}

export interface OutboundDeliveryItem {
  id: string;
  event: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: Iso;
  completedAt: Iso | null;
  nextAttemptAt: Iso | null;
}

export interface OutboundDeliveryDetail extends OutboundDeliveryItem {
  /** Exactly what is sent, after formatting for the endpoint. */
  requestBody: string;
  responseBody: string | null;
}

// ── Work records ─────────────────────────────────────────────

export interface WorkRecordEvidence {
  kind: "pull_request";
  repo: string;
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  additions: number;
  deletions: number;
}

export interface WorkRecordTask {
  identifier: string;
  title: string;
  completedAt: string;
}

export interface WorkRecordClaims {
  v: number;
  id: string;
  issuer: string;
  issuedAt: string;
  subject: { username: string; name: string; github: string | null };
  /** Private projects are redacted: no name, link, or item titles; counts only. */
  project: { name: string | null; url: string | null; visibility: "PUBLIC" | "UNLISTED" | "PRIVATE" };
  role: string;
  memberSince: string;
  period: { from: string; to: string };
  summary: {
    tasksCompleted: number;
    pullRequestsMerged: number;
    additions: number;
    deletions: number;
    reviews: number;
    releases: number;
  };
  /** How each figure was established, so a reader knows what is GitHub-verified and what is tracked in bld.t. */
  sources: { pullRequests: "github"; reviews: "github"; tasks: "bldt"; releases: "bldt" };
  evidence: WorkRecordEvidence[];
  tasks: WorkRecordTask[];
}

export interface SignedWorkRecord {
  record: WorkRecordClaims;
  signature: { alg: "Ed25519"; kid: string; value: string };
}


export interface WorkRecordItem {
  id: string;
  project: { name: string | null; owner: string | null; slug: string | null; visibility: string };
  period: { from: string; to: string };
  summary: WorkRecordClaims["summary"];
  createdAt: Iso;
  revokedAt: Iso | null;
}

export type WorkRecordStatus = "valid" | "revoked" | "invalid";

export interface WorkRecordView {
  signed: SignedWorkRecord;
  status: WorkRecordStatus;
  revokedAt: Iso | null;
  revokedReason: string | null;
  /** Whether the signing key is the current one or a retired (still published) one. */
  keyStatus: "current" | "retired" | "unknown";
}

export interface WorkRecordVerification {
  status: WorkRecordStatus | "unknown_record";
  reason: "malformed" | "unknown_key" | "bad_signature" | null;
  record: WorkRecordClaims | null;
  revokedAt: Iso | null;
}

// ── Discussions ──────────────────────────────────────────────

export interface DiscussionSummary {
  id: string;
  number: number;
  category: "GENERAL" | "HELP" | "IDEAS" | "ANNOUNCEMENTS";
  title: string;
  excerpt: string;
  author: UserRef;
  replyCount: number;
  solved: boolean;
  pinned: boolean;
  locked: boolean;
  /** First line of the error for help threads, for scanning a list. */
  errorHeadline: string | null;
  filePath: string | null;
  lastActivityAt: Iso;
  createdAt: Iso;
}

export interface ErrorContext {
  errorMessage: string;
  language: string | null;
  filePath: string | null;
  line: number | null;
  codeSnippet: string | null;
  branch: string | null;
  commitSha: string | null;
  /** Links into the project's primary GitHub repository, when it has one. */
  fileUrl: string | null;
  commitUrl: string | null;
}

export interface DiscussionReplyItem {
  id: string;
  author: UserRef;
  body: string;
  createdAt: Iso;
  editedAt: Iso | null;
  helpful: number;
  votedByMe: boolean;
  isAnswer: boolean;
  canEdit: boolean;
  /** Written by the viewer: no helpful vote on your own reply. */
  mine: boolean;
}

/** The same error, seen before in a project the viewer belongs to. */
export interface SimilarError {
  project: { name: string; slug: string; ownerUsername: string };
  number: number;
  title: string;
  solved: boolean;
  createdAt: Iso;
  answer: { excerpt: string; author: UserRef } | null;
}

export interface DiscussionDetail extends DiscussionSummary {
  body: string;
  error: ErrorContext | null;
  answerId: string | null;
  replies: DiscussionReplyItem[];
  similar: SimilarError[];
  viewer: { canReply: boolean; canEdit: boolean; canModerate: boolean; canAnswer: boolean };
}

// ── Presence and huddles ─────────────────────────────────────

export interface PresenceEntry {
  user: UserRef;
  state: "active" | "idle";
  branch: string | null;
  filePath: string | null;
  task: { number: number; identifier: string; title: string } | null;
  client: string;
  /** When they started on this file or branch. */
  since: Iso;
  lastSeenAt: Iso;
}

export interface OverlapWarning {
  user: UserRef;
  filePath: string;
  branch: string | null;
  sameBranch: boolean;
}

export interface HuddleItem {
  id: string;
  kind: "HUDDLE" | "PAIR";
  url: string;
  topic: string | null;
  host: UserRef;
  project: { name: string; slug: string; ownerUsername: string };
  createdAt: Iso;
  endsAt: Iso;
  active: boolean;
}

// ── Search ───────────────────────────────────────────────────

/** A text fragment with matches marked: even entries are plain text, odd entries matched. */
export type Highlight = string[];

interface HitBase {
  project: { name: string; slug: string; ownerUsername: string };
  /** Body fragment around the match, or empty when only the title matched. */
  snippet: Highlight;
  rank: number;
}

export interface TaskHit extends HitBase {
  identifier: string;
  number: number;
  title: string;
  status: TaskStatus;
}

export interface DiscussionHit extends HitBase {
  number: number;
  title: string;
  category: "GENERAL" | "HELP" | "IDEAS" | "ANNOUNCEMENTS";
  solved: boolean;
  /** True when the match came from a reply rather than the thread itself. */
  inReply: boolean;
}

export interface PullRequestHit extends HitBase {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  repo: string;
}

export interface ReleaseHit extends HitBase {
  id: string;
  title: string;
  version: string | null;
  shippedAt: Iso;
}

export interface FullSearchResults {
  tasks: TaskHit[];
  discussions: DiscussionHit[];
  pullRequests: PullRequestHit[];
  releases: ReleaseHit[];
  /** For a single-type query: whether another page exists. */
  hasMore: boolean;
}

// ── Changelog ────────────────────────────────────────────────

export interface ChangelogDto {
  range: { from: Iso | null; to: Iso; fromLabel: string | null; toLabel: string };
  sections: {
    kind: string;
    title: string;
    items: { text: string; scope: string | null; pr: { number: number; url: string; repo: string } | null; author: string | null; tasks: string[] }[];
  }[];
  contributors: string[];
  stats: { pullRequests: number; tasks: number; contributors: number; additions: number; deletions: number };
  markdown: string;
  /** True when more merged pull requests exist than were included. */
  truncated: boolean;
}
