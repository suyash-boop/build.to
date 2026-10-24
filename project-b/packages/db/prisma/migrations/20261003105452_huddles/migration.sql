-- CreateEnum
CREATE TYPE "HuddleKind" AS ENUM ('HUDDLE', 'PAIR');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "meetingUrl" TEXT;

-- CreateTable
CREATE TABLE "Huddle" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "kind" "HuddleKind" NOT NULL DEFAULT 'HUDDLE',
    "url" TEXT NOT NULL,
    "topic" TEXT,
    "invitees" UUID[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Huddle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Huddle_projectId_createdAt_idx" ON "Huddle"("projectId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Huddle" ADD CONSTRAINT "Huddle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Huddle" ADD CONSTRAINT "Huddle_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
