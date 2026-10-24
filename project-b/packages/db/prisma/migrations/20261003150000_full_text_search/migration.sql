-- Full-text search. Expression GIN indexes, so the Prisma schema stays unchanged; queries in
-- apps/api/src/modules/search.ts must use these exact expressions to hit the indexes.
-- Weights: A = title, B = body, C = error text.

CREATE INDEX "Task_fts_idx" ON "Task" USING GIN (
  (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B'))
);

CREATE INDEX "Discussion_fts_idx" ON "Discussion" USING GIN (
  (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B') || setweight(to_tsvector('english', coalesce("errorMessage", '')), 'C'))
);

CREATE INDEX "DiscussionReply_fts_idx" ON "DiscussionReply" USING GIN (
  (to_tsvector('english', coalesce("body", '')))
);

CREATE INDEX "PullRequest_fts_idx" ON "PullRequest" USING GIN (
  (to_tsvector('english', coalesce("title", '')))
);

CREATE INDEX "Release_fts_idx" ON "Release" USING GIN (
  (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("notes", '')), 'B'))
);
