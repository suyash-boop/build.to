-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'QUEUED', 'SYNCING', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('IDEA', 'BUILDING', 'SHIPPED', 'MAINTAINED', 'PAUSED', 'SUNSET');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'MAINTAINER', 'CONTRIBUTOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CommentSubject" AS ENUM ('PROJECT', 'TASK', 'MILESTONE', 'RELEASE');

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "ReleaseSource" AS ENUM ('MANUAL', 'GITHUB_RELEASE', 'DEPLOYMENT');

-- CreateEnum
CREATE TYPE "DeploymentState" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILURE', 'ERROR', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TechCategory" AS ENUM ('LANGUAGE', 'FRAMEWORK', 'DATABASE', 'INFRASTRUCTURE', 'TOOL');

-- CreateEnum
CREATE TYPE "TechSource" AS ENUM ('DETECTED', 'MANUAL');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('BLDT', 'GITHUB');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('CONNECTED', 'PLATFORM', 'SELF_REPORTED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "SignalSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WebhookFormat" AS ENUM ('JSON', 'SLACK', 'DISCORD');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('BROWSER', 'DEVICE');

-- CreateEnum
CREATE TYPE "DeviceAuthStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "DiscussionCategory" AS ENUM ('GENERAL', 'HELP', 'IDEAS', 'ANNOUNCEMENTS');

-- CreateEnum
CREATE TYPE "HuddleKind" AS ENUM ('HUDDLE', 'PAIR');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "focusAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "headline" TEXT,
ADD COLUMN     "meetingUrl" TEXT,
ADD COLUMN     "openToWork" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WorkspaceSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "SessionKind" NOT NULL DEFAULT 'BROWSER',
    "clientName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "WorkspaceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubAccount" (
    "userId" TEXT NOT NULL,
    "githubUserId" BIGINT NOT NULL,
    "login" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GithubInstallation" (
    "id" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountId" BIGINT NOT NULL,
    "accountType" TEXT NOT NULL,
    "repoSelection" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" UUID NOT NULL,
    "githubId" BIGINT NOT NULL,
    "installationId" BIGINT,
    "ownerLogin" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "description" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "homepageUrl" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "isPrivate" BOOLEAN NOT NULL,
    "isFork" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "primaryLanguage" TEXT,
    "languages" JSONB NOT NULL DEFAULT '{}',
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stars" INTEGER NOT NULL DEFAULT 0,
    "pushedAt" TIMESTAMP(3),
    "readme" TEXT,
    "detectedStack" JSONB NOT NULL DEFAULT '[]',
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "syncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "stage" "ProjectStage" NOT NULL DEFAULT 'BUILDING',
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "homepageUrl" TEXT,
    "openToContributors" BOOLEAN NOT NULL DEFAULT false,
    "lookingFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "taskCounter" INTEGER NOT NULL DEFAULT 0,
    "discussionCounter" INTEGER NOT NULL DEFAULT 0,
    "signalSettings" JSONB NOT NULL DEFAULT '{}',
    "shippedAt" TIMESTAMP(3),
    "sunsetAt" TIMESTAMP(3),
    "retrospective" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "title" TEXT,
    "showOnProfile" BOOLEAN NOT NULL DEFAULT true,
    "profileOrder" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "ProjectRepository" (
    "projectId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("projectId","repositoryId")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT,
    "email" TEXT,
    "role" "ProjectRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoinRequest" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "roleWanted" TEXT,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "dueOn" DATE,
    "completedAt" TIMESTAMP(3),
    "position" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NONE',
    "position" DOUBLE PRECISION NOT NULL,
    "assigneeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "milestoneId" UUID,
    "dueOn" DATE,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "githubIssueId" BIGINT,
    "githubIssueNumber" INTEGER,
    "githubIssueUrl" TEXT,
    "githubAuthorLogin" TEXT,
    "githubIssueState" TEXT,
    "githubUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectComment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "subjectType" "CommentSubject" NOT NULL,
    "subjectId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" UUID NOT NULL,
    "githubId" BIGINT NOT NULL,
    "repositoryId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "state" "PullRequestState" NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "authorLogin" TEXT NOT NULL,
    "authorGithubId" BIGINT,
    "headRef" TEXT NOT NULL,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changedFiles" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "githubUpdatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestTask" (
    "pullRequestId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "closes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PullRequestTask_pkey" PRIMARY KEY ("pullRequestId","taskId")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "url" TEXT,
    "commitSha" TEXT,
    "source" "ReleaseSource" NOT NULL,
    "externalId" TEXT,
    "isShip" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "shippedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "githubId" BIGINT NOT NULL,
    "environment" TEXT NOT NULL,
    "state" "DeploymentState" NOT NULL,
    "url" TEXT,
    "sha" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "creatorLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "userId" TEXT,
    "githubLogin" TEXT NOT NULL,
    "githubUserId" BIGINT,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "prsOpened" INTEGER NOT NULL DEFAULT 0,
    "prsMerged" INTEGER NOT NULL DEFAULT 0,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "firstAt" TIMESTAMP(3),
    "lastAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Technology" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TechCategory" NOT NULL,
    "color" TEXT,

    CONSTRAINT "Technology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTechnology" (
    "projectId" UUID NOT NULL,
    "technologyId" UUID NOT NULL,
    "source" "TechSource" NOT NULL,
    "share" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProjectTechnology_pkey" PRIMARY KEY ("projectId","technologyId")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "actorId" TEXT,
    "actorLogin" TEXT,
    "source" "EventSource" NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "trust" "TrustLevel" NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectNotification" (
    "id" UUID NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "projectId" UUID,
    "data" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "installationId" BIGINT,
    "repositoryGithubId" BIGINT,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBrief" (
    "projectId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBrief_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "SignalSeverity" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "snoozedById" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "notifiedSeverity" "SignalSeverity",

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" TEXT,
    "url" TEXT NOT NULL,
    "format" "WebhookFormat" NOT NULL DEFAULT 'JSON',
    "description" TEXT,
    "events" TEXT[],
    "secretEncrypted" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundDelivery" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboundStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OutboundDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkRecord" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" UUID,
    "kid" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAuthorization" (
    "id" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "status" "DeviceAuthStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "ip" TEXT,
    "intervalSec" INTEGER NOT NULL DEFAULT 5,
    "lastPolledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discussion" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" "DiscussionCategory" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "errorMessage" TEXT,
    "errorFingerprint" TEXT,
    "language" TEXT,
    "filePath" TEXT,
    "line" INTEGER,
    "codeSnippet" TEXT,
    "branch" TEXT,
    "commitSha" TEXT,
    "answerId" UUID,
    "solvedAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Discussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionReply" (
    "id" UUID NOT NULL,
    "discussionId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionVote" (
    "replyId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionVote_pkey" PRIMARY KEY ("replyId","userId")
);

-- CreateTable
CREATE TABLE "Huddle" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "hostId" TEXT NOT NULL,
    "kind" "HuddleKind" NOT NULL DEFAULT 'HUDDLE',
    "url" TEXT NOT NULL,
    "topic" TEXT,
    "invitees" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Huddle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceSession_userId_idx" ON "WorkspaceSession"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceSession_expiresAt_idx" ON "WorkspaceSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GithubAccount_githubUserId_key" ON "GithubAccount"("githubUserId");

-- CreateIndex
CREATE INDEX "GithubAccount_login_idx" ON "GithubAccount"("login");

-- CreateIndex
CREATE INDEX "GithubInstallation_accountLogin_idx" ON "GithubInstallation"("accountLogin");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubId_key" ON "Repository"("githubId");

-- CreateIndex
CREATE INDEX "Repository_installationId_idx" ON "Repository"("installationId");

-- CreateIndex
CREATE INDEX "Repository_fullName_idx" ON "Repository"("fullName");

-- CreateIndex
CREATE INDEX "Project_visibility_stage_updatedAt_idx" ON "Project"("visibility", "stage", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_openToContributors_visibility_idx" ON "Project"("openToContributors", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ownerId_slug_key" ON "Project"("ownerId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ownerId_key_key" ON "Project"("ownerId", "key");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE INDEX "ProjectRepository_repositoryId_idx" ON "ProjectRepository"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_projectId_status_idx" ON "Invitation"("projectId", "status");

-- CreateIndex
CREATE INDEX "Invitation_inviteeId_status_idx" ON "Invitation"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "JoinRequest_projectId_status_idx" ON "JoinRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "JoinRequest_userId_status_idx" ON "JoinRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "Milestone_projectId_position_idx" ON "Milestone"("projectId", "position");

-- CreateIndex
CREATE INDEX "Task_projectId_status_position_idx" ON "Task"("projectId", "status", "position");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_milestoneId_idx" ON "Task"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_number_key" ON "Task"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_githubIssueId_key" ON "Task"("projectId", "githubIssueId");

-- CreateIndex
CREATE INDEX "ProjectComment_subjectType_subjectId_createdAt_idx" ON "ProjectComment"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectComment_projectId_idx" ON "ProjectComment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_githubId_key" ON "PullRequest"("githubId");

-- CreateIndex
CREATE INDEX "PullRequest_authorGithubId_idx" ON "PullRequest"("authorGithubId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repositoryId_number_key" ON "PullRequest"("repositoryId", "number");

-- CreateIndex
CREATE INDEX "PullRequestTask_taskId_idx" ON "PullRequestTask"("taskId");

-- CreateIndex
CREATE INDEX "Release_projectId_shippedAt_idx" ON "Release"("projectId", "shippedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Release_projectId_source_externalId_key" ON "Release"("projectId", "source", "externalId");

-- CreateIndex
CREATE INDEX "Deployment_projectId_environment_createdAt_idx" ON "Deployment"("projectId", "environment", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_projectId_githubId_key" ON "Deployment"("projectId", "githubId");

-- CreateIndex
CREATE INDEX "Contribution_userId_idx" ON "Contribution"("userId");

-- CreateIndex
CREATE INDEX "Contribution_githubUserId_idx" ON "Contribution"("githubUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_projectId_repositoryId_githubLogin_key" ON "Contribution"("projectId", "repositoryId", "githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "Technology_slug_key" ON "Technology"("slug");

-- CreateIndex
CREATE INDEX "ProjectTechnology_technologyId_idx" ON "ProjectTechnology"("technologyId");

-- CreateIndex
CREATE INDEX "ActivityEvent_projectId_occurredAt_idx" ON "ActivityEvent"("projectId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityEvent_actorId_occurredAt_idx" ON "ActivityEvent"("actorId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityEvent_projectId_source_externalId_key" ON "ActivityEvent"("projectId", "source", "externalId");

-- CreateIndex
CREATE INDEX "ProjectNotification_recipientId_readAt_createdAt_idx" ON "ProjectNotification"("recipientId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookDelivery_repositoryGithubId_receivedAt_idx" ON "WebhookDelivery"("repositoryGithubId", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_receivedAt_idx" ON "WebhookDelivery"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Signal_projectId_resolvedAt_idx" ON "Signal"("projectId", "resolvedAt");

-- CreateIndex
CREATE INDEX "Signal_resolvedAt_severity_idx" ON "Signal"("resolvedAt", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_projectId_dedupeKey_key" ON "Signal"("projectId", "dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_projectId_idx" ON "WebhookEndpoint"("projectId");

-- CreateIndex
CREATE INDEX "OutboundDelivery_endpointId_createdAt_idx" ON "OutboundDelivery"("endpointId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OutboundDelivery_status_nextAttemptAt_idx" ON "OutboundDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDelivery_endpointId_sourceKey_key" ON "OutboundDelivery"("endpointId", "sourceKey");

-- CreateIndex
CREATE INDEX "WorkRecord_userId_createdAt_idx" ON "WorkRecord"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkRecord_projectId_idx" ON "WorkRecord"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthorization_userCode_key" ON "DeviceAuthorization"("userCode");

-- CreateIndex
CREATE INDEX "DeviceAuthorization_expiresAt_idx" ON "DeviceAuthorization"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Discussion_answerId_key" ON "Discussion"("answerId");

-- CreateIndex
CREATE INDEX "Discussion_projectId_lastActivityAt_idx" ON "Discussion"("projectId", "lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "Discussion_projectId_errorFingerprint_idx" ON "Discussion"("projectId", "errorFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Discussion_projectId_number_key" ON "Discussion"("projectId", "number");

-- CreateIndex
CREATE INDEX "DiscussionReply_discussionId_createdAt_idx" ON "DiscussionReply"("discussionId", "createdAt");

-- CreateIndex
CREATE INDEX "Huddle_projectId_createdAt_idx" ON "Huddle"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_deletedAt_idx" ON "user"("deletedAt");

-- AddForeignKey
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubAccount" ADD CONSTRAINT "GithubAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GithubInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestTask" ADD CONSTRAINT "PullRequestTask_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestTask" ADD CONSTRAINT "PullRequestTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTechnology" ADD CONSTRAINT "ProjectTechnology_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTechnology" ADD CONSTRAINT "ProjectTechnology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "Technology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNotification" ADD CONSTRAINT "ProjectNotification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBrief" ADD CONSTRAINT "ProjectBrief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRecord" ADD CONSTRAINT "WorkRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRecord" ADD CONSTRAINT "WorkRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAuthorization" ADD CONSTRAINT "DeviceAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "DiscussionReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionVote" ADD CONSTRAINT "DiscussionVote_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "DiscussionReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionVote" ADD CONSTRAINT "DiscussionVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Huddle" ADD CONSTRAINT "Huddle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Huddle" ADD CONSTRAINT "Huddle_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- build.to workspace database extras
UPDATE "user" SET "profileImage" = COALESCE("profileImage", "image");

-- Retained from Project B: 20261003120000_realtime_triggers
-- Realtime change feed. Statement-level triggers read the transition table and send one
-- pg_notify per affected project (or recipient) per statement. Notifications are delivered at
-- commit, and identical payloads within a transaction are collapsed by Postgres, so a bulk
-- reorder of 200 tasks produces one event. Payloads carry ids only, never row contents:
-- listeners decide who may see what.

CREATE OR REPLACE FUNCTION bldt_rt_by_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid;
BEGIN
  FOR pid IN SELECT DISTINCT "projectId" FROM changed LOOP
    PERFORM pg_notify('bldt_realtime', json_build_object('k', TG_ARGV[0], 'p', pid)::text);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION bldt_rt_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid;
BEGIN
  FOR pid IN SELECT DISTINCT "id" FROM changed LOOP
    PERFORM pg_notify('bldt_realtime', json_build_object('k', 'project', 'p', pid)::text);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION bldt_rt_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT "projectId", "userId" FROM changed LOOP
    PERFORM pg_notify('bldt_realtime', json_build_object('k', 'member', 'p', r."projectId", 'u', r."userId", 'op', lower(TG_OP))::text);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION bldt_rt_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid text;
BEGIN
  FOR uid IN SELECT DISTINCT "recipientId" FROM changed LOOP
    PERFORM pg_notify('bldt_realtime', json_build_object('k', 'notification', 'u', uid)::text);
  END LOOP;
  RETURN NULL;
END $$;

-- Transition tables allow one event per trigger, hence three triggers per table.
DO $$
DECLARE
  spec text[];
  ev text;
  specs text[][] := ARRAY[
    ['Task', 'bldt_rt_by_project', 'task'],
    ['ProjectComment', 'bldt_rt_by_project', 'comment'],
    ['Milestone', 'bldt_rt_by_project', 'milestone'],
    ['ActivityEvent', 'bldt_rt_by_project', 'activity'],
    ['Signal', 'bldt_rt_by_project', 'signal'],
    ['Project', 'bldt_rt_project', ''],
    ['ProjectMember', 'bldt_rt_member', ''],
    ['ProjectNotification', 'bldt_rt_notification', '']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    FOREACH ev IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      EXECUTE format(
        'CREATE TRIGGER %I AFTER %s ON %I REFERENCING %s TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION %I(%L)',
        'rt_' || lower(spec[1]) || '_' || lower(ev),
        ev,
        spec[1],
        CASE WHEN ev = 'DELETE' THEN 'OLD' ELSE 'NEW' END,
        spec[2],
        spec[3]
      );
    END LOOP;
  END LOOP;
END $$;


-- Retained from Project B: 20261003130000_discussion_realtime
-- Live updates for discussions: same statement-level pattern as the realtime_triggers migration.
DO $$
DECLARE
  spec text[];
  ev text;
  specs text[][] := ARRAY[
    ['Discussion', 'bldt_rt_by_project', 'discussion'],
    ['DiscussionReply', 'bldt_rt_by_project', 'discussion']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    FOREACH ev IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      EXECUTE format(
        'CREATE TRIGGER %I AFTER %s ON %I REFERENCING %s TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION %I(%L)',
        'rt_' || lower(spec[1]) || '_' || lower(ev),
        ev,
        spec[1],
        CASE WHEN ev = 'DELETE' THEN 'OLD' ELSE 'NEW' END,
        spec[2],
        spec[3]
      );
    END LOOP;
  END LOOP;
END $$;


-- Retained from Project B: 20261003150000_full_text_search
-- Full-text search. Expression GIN indexes, so the Prisma schema stays unchanged; queries in
-- apps/api/src/modules/search.ts must use these exact expressions to hit the indexes.
-- Weights: A = title, B = body, C = error text.

CREATE INDEX "Task_fts_idx" ON "Task" USING GIN (
  (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B'))
);

CREATE INDEX "Discussion_fts_idx" ON "Discussion" USING GIN (
  (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B') || setweight(to_tsvector('english', coalesce("errorMessage", '')), 'C'))
);

CREATE INDEX "DiscussionReply_fts_idx" ON "DiscussionReply" USING GIN (
  (to_tsvector('english', coalesce("body", '')))
);

CREATE INDEX "PullRequest_fts_idx" ON "PullRequest" USING GIN (
  (to_tsvector('english', coalesce("title", '')))
);

CREATE INDEX "Release_fts_idx" ON "Release" USING GIN (
  (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("notes", '')), 'B'))
);


-- Retained from Project B: 20261003170000_activity_task_index
-- Task history: events that mention a task carry its id in payload.taskId. A partial expression
-- index turns the task-detail lookup from a scan of the project's whole feed into an index probe.
-- apps/api/src/modules/tasks.ts queries with this exact expression.
CREATE INDEX "ActivityEvent_projectId_taskId_idx" ON "ActivityEvent" ("projectId", ("payload"->>'taskId')) WHERE "payload" ? 'taskId';

