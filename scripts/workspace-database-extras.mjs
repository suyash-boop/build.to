import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "prisma/migrations/20261023180000_merge_project_workspace/migration.sql");
const existing = await readFile(target, "utf8");
if (existing.includes("-- build.to workspace database extras")) throw new Error("Extras already appended; regenerate the migration before running again.");
const migrations = ["20261003120000_realtime_triggers", "20261003130000_discussion_realtime", "20261003150000_full_text_search", "20261003170000_activity_task_index"];
let extras = "\n-- build.to workspace database extras\nUPDATE \"user\" SET \"profileImage\" = COALESCE(\"profileImage\", \"image\");\n";
for (const migration of migrations) {
  let sql = await readFile(path.join(root, "project-b/packages/db/prisma/migrations", migration, "migration.sql"), "utf8");
  sql = sql.replace(/'Comment'/g, "'ProjectComment'").replace(/'Notification'/g, "'ProjectNotification'").replace("DECLARE uid uuid;", "DECLARE uid text;");
  extras += `\n-- Retained from Project B: ${migration}\n${sql}\n`;
}
await appendFile(target, extras);
