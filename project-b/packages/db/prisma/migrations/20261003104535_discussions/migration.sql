-- CreateEnum
CREATE TYPE "DiscussionCategory" AS ENUM ('GENERAL', 'HELP', 'IDEAS', 'ANNOUNCEMENTS');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "discussionCounter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Discussion" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" UUID NOT NULL,
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
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionVote" (
    "replyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionVote_pkey" PRIMARY KEY ("replyId","userId")
);

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

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discussion" ADD CONSTRAINT "Discussion_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "DiscussionReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionVote" ADD CONSTRAINT "DiscussionVote_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "DiscussionReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionVote" ADD CONSTRAINT "DiscussionVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
