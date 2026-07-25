-- Add showcasedRepos JSON column to user (curated GitHub projects).
ALTER TABLE "user" ADD COLUMN "showcasedRepos" JSONB;
