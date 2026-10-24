-- DropIndex
DROP INDEX "Deployment_githubId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_projectId_githubId_key" ON "Deployment"("projectId", "githubId");

