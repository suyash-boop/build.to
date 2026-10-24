-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "githubAuthorLogin" TEXT,
ADD COLUMN     "githubIssueId" BIGINT,
ADD COLUMN     "githubIssueNumber" INTEGER,
ADD COLUMN     "githubIssueUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_githubIssueId_key" ON "Task"("projectId", "githubIssueId");

