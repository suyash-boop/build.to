-- CreateTable
CREATE TABLE "ProjectBrief" (
    "projectId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "generatedById" UUID,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBrief_pkey" PRIMARY KEY ("projectId")
);

-- AddForeignKey
ALTER TABLE "ProjectBrief" ADD CONSTRAINT "ProjectBrief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
