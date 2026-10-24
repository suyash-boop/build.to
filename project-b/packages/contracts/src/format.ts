import type { ProjectStage, TaskPriority, TaskStatus } from "./enums.ts";

export const STAGE_LABEL: Record<ProjectStage, string> = {
  IDEA: "Idea",
  BUILDING: "Building",
  SHIPPED: "Shipped",
  MAINTAINED: "Maintained",
  PAUSED: "Paused",
  SUNSET: "Sunset",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  TODO: "Todo",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
  CANCELED: "Canceled",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  NONE: "No priority",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const taskIdentifier = (key: string, number: number) => `${key}-${number}`;

/** Derive a project key from its name: "Relay API" -> "RELAY", "inkwell" -> "INK". */
export function suggestProjectKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0] ?? "";
  let key: string;
  if (words.length >= 3) key = words.map((w) => w[0]).join("");
  else if (first.length <= 5) key = first;
  else key = first.slice(0, 3);
  key = key.replace(/^[0-9]+/, "");
  if (key.length < 2) key = (key + "PRJ").slice(0, 3);
  return key.slice(0, 10);
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-._]+|[-._]+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 64) || "project"
  );
}
