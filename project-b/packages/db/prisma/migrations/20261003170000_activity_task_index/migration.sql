-- Task history: events that mention a task carry its id in payload.taskId. A partial expression
-- index turns the task-detail lookup from a scan of the project's whole feed into an index probe.
-- apps/api/src/modules/tasks.ts queries with this exact expression.
CREATE INDEX "ActivityEvent_projectId_taskId_idx" ON "ActivityEvent" ("projectId", ("payload"->>'taskId')) WHERE "payload" ? 'taskId';
