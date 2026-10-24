-- CreateEnum
CREATE TYPE "WebhookFormat" AS ENUM ('JSON', 'SLACK', 'DISCORD');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID,
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

-- CreateIndex
CREATE INDEX "WebhookEndpoint_projectId_idx" ON "WebhookEndpoint"("projectId");

-- CreateIndex
CREATE INDEX "OutboundDelivery_endpointId_createdAt_idx" ON "OutboundDelivery"("endpointId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OutboundDelivery_status_nextAttemptAt_idx" ON "OutboundDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDelivery_endpointId_sourceKey_key" ON "OutboundDelivery"("endpointId", "sourceKey");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
