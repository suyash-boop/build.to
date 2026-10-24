-- AlterTable
ALTER TABLE "PullRequest" ADD COLUMN     "githubUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "githubIssueState" TEXT,
ADD COLUMN     "githubUpdatedAt" TIMESTAMP(3);

