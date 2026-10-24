-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "detectedStack" JSONB NOT NULL DEFAULT '[]';
