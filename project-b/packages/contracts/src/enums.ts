import { z } from "zod";

export const ProjectStage = z.enum(["IDEA", "BUILDING", "SHIPPED", "MAINTAINED", "PAUSED", "SUNSET"]);
export type ProjectStage = z.infer<typeof ProjectStage>;

export const Visibility = z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]);
export type Visibility = z.infer<typeof Visibility>;

export const ProjectRole = z.enum(["OWNER", "MAINTAINER", "CONTRIBUTOR", "VIEWER"]);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const TaskStatus = z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELED"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const MilestoneStatus = z.enum(["PLANNED", "ACTIVE", "DONE", "CANCELED"]);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

export const TrustLevel = z.enum(["CONNECTED", "PLATFORM", "SELF_REPORTED"]);
export type TrustLevel = z.infer<typeof TrustLevel>;

export const TechCategory = z.enum(["LANGUAGE", "FRAMEWORK", "DATABASE", "INFRASTRUCTURE", "TOOL"]);
export type TechCategory = z.infer<typeof TechCategory>;

export const SyncStatus = z.enum(["IDLE", "QUEUED", "SYNCING", "FAILED"]);
export type SyncStatus = z.infer<typeof SyncStatus>;

export const DeploymentState = z.enum(["PENDING", "IN_PROGRESS", "SUCCESS", "FAILURE", "ERROR", "INACTIVE"]);
export type DeploymentState = z.infer<typeof DeploymentState>;

/** Statuses that count as finished work. */
export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ["DONE", "CANCELED"];
