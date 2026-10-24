-- CreateTable
CREATE TABLE "WorkRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
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

-- CreateIndex
CREATE INDEX "WorkRecord_userId_createdAt_idx" ON "WorkRecord"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkRecord_projectId_idx" ON "WorkRecord"("projectId");

-- AddForeignKey
ALTER TABLE "WorkRecord" ADD CONSTRAINT "WorkRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRecord" ADD CONSTRAINT "WorkRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
