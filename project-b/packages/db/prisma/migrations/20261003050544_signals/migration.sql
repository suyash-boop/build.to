-- CreateEnum
CREATE TYPE "SignalSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "signalSettings" JSONB NOT NULL DEFAULT '{}';

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
    "snoozedById" UUID,
    "notifiedAt" TIMESTAMP(3),
    "notifiedSeverity" "SignalSeverity",

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signal_projectId_resolvedAt_idx" ON "Signal"("projectId", "resolvedAt");

-- CreateIndex
CREATE INDEX "Signal_resolvedAt_severity_idx" ON "Signal"("resolvedAt", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_projectId_dedupeKey_key" ON "Signal"("projectId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
