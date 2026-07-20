-- Full-text search for posts (PRD §5.9 — Postgres FTS, no Elasticsearch).
--
-- Modeled on Forem's reading_list_document: a weighted tsvector so a title hit
-- ranks above a body hit. Forem maintains theirs with a BEFORE INSERT/UPDATE
-- trigger; Postgres 12+ generated columns do the same job without a trigger to
-- keep in sync, and cannot drift from the row.
--
-- Weights: A = title, B = description, C = body.

ALTER TABLE "post" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("bodyMarkdown", '')), 'C')
  ) STORED;

CREATE INDEX "post_searchVector_idx" ON "post" USING GIN ("searchVector");
