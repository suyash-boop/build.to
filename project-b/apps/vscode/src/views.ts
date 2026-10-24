import * as vscode from "vscode";
import type { Session } from "./session.ts";

export type Status = "BACKLOG" | "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELED";

export interface MyTask {
  id: string;
  number: number;
  identifier: string;
  title: string;
  status: Status;
  priority: string;
  dueOn: string | null;
  prCount: number;
  project: { name: string; slug: string; ownerUsername: string; key: string };
}

export const STATUS_LABEL: Record<Status, string> = {
  BACKLOG: "Backlog",
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
  CANCELED: "Canceled",
};

const STATUS_ICON: Record<Status, vscode.ThemeIcon> = {
  BACKLOG: new vscode.ThemeIcon("circle-large-outline", new vscode.ThemeColor("disabledForeground")),
  TODO: new vscode.ThemeIcon("circle-outline"),
  IN_PROGRESS: new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.yellow")),
  IN_REVIEW: new vscode.ThemeIcon("eye", new vscode.ThemeColor("charts.blue")),
  DONE: new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("charts.green")),
  CANCELED: new vscode.ThemeIcon("circle-slash"),
};

const ORDER: Status[] = ["IN_PROGRESS", "IN_REVIEW", "TODO", "BACKLOG"];

type TaskNode = { kind: "project"; name: string; tasks: MyTask[] } | { kind: "task"; task: MyTask } | { kind: "message"; text: string };

/** Tasks assigned to you across projects, grouped by project, in-progress first. */
export class TasksView implements vscode.TreeDataProvider<TaskNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  tasks: MyTask[] = [];
  private error: string | null = null;

  constructor(private session: Session) {}

  async refresh() {
    if (!this.session.signedIn) {
      this.tasks = [];
    } else {
      try {
        this.tasks = (await this.session.api.get<{ myTasks: MyTask[] }>("/home")).myTasks;
        this.error = null;
      } catch (err) {
        this.error = (err as Error).message;
      }
    }
    this.emitter.fire();
  }

  getTreeItem(n: TaskNode): vscode.TreeItem {
    if (n.kind === "message") return new vscode.TreeItem(n.text);
    if (n.kind === "project") {
      const item = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${n.tasks.length}`;
      item.iconPath = new vscode.ThemeIcon("project");
      return item;
    }
    const t = n.task;
    const item = new vscode.TreeItem(t.title);
    item.description = [t.identifier, t.dueOn ? `due ${t.dueOn}` : null].filter(Boolean).join(" · ");
    item.iconPath = STATUS_ICON[t.status];
    item.contextValue = "task";
    item.tooltip = new vscode.MarkdownString(`**${t.identifier}** ${t.title}\n\n${STATUS_LABEL[t.status]} · ${t.priority.toLowerCase()} priority${t.prCount ? ` · ${t.prCount} pull request${t.prCount > 1 ? "s" : ""}` : ""}${t.dueOn ? ` · due ${t.dueOn}` : ""}`);
    item.command = { command: "bldt.taskActions", title: "Task actions", arguments: [t] };
    return item;
  }

  getChildren(n?: TaskNode): TaskNode[] {
    if (n?.kind === "project") return n.tasks.map((task) => ({ kind: "task", task }));
    if (n) return [];
    if (!this.session.signedIn) return [];
    if (this.error) return [{ kind: "message", text: `Could not load tasks: ${this.error}` }];
    if (this.tasks.length === 0) return [{ kind: "message", text: "Nothing assigned to you. Nice." }];
    const byProject = new Map<string, MyTask[]>();
    for (const t of this.tasks) byProject.set(t.project.name, [...(byProject.get(t.project.name) ?? []), t]);
    return [...byProject.entries()].map(([name, tasks]) => ({
      kind: "project",
      name,
      tasks: tasks.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)),
    }));
  }
}

// ── Team ─────────────────────────────────────────────────────

export interface Person {
  user: { id: string; username: string; displayName: string };
  state: "active" | "idle";
  branch: string | null;
  filePath: string | null;
  task: { identifier: string; title: string } | null;
  since: string;
}

export interface TeamGroup {
  project: { name: string; slug: string; ownerUsername: string };
  people: Person[];
}

export type TeamNode = { kind: "project"; group: TeamGroup } | { kind: "person"; person: Person; project: TeamGroup["project"] } | { kind: "message"; text: string };

function since(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins < 1 ? "just now" : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Teammates working right now, from their editors. */
export class TeamView implements vscode.TreeDataProvider<TeamNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  groups: TeamGroup[] = [];

  constructor(private session: Session) {}

  async refresh() {
    try {
      this.groups = this.session.signedIn ? (await this.session.api.get<{ items: TeamGroup[] }>("/me/team")).items : [];
    } catch {
      /* keep the last known list */
    }
    this.emitter.fire();
  }

  getTreeItem(n: TeamNode): vscode.TreeItem {
    if (n.kind === "message") return new vscode.TreeItem(n.text);
    if (n.kind === "project") {
      const item = new vscode.TreeItem(n.group.project.name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${n.group.people.length} online`;
      item.iconPath = new vscode.ThemeIcon("project");
      return item;
    }
    const p = n.person;
    const item = new vscode.TreeItem(p.user.displayName);
    const where = p.task?.identifier ?? (p.filePath ? p.filePath.split("/").pop() : p.branch) ?? "";
    item.description = [where, p.state === "idle" ? "idle" : since(p.since)].filter(Boolean).join(" · ");
    item.iconPath = new vscode.ThemeIcon("account", new vscode.ThemeColor(p.state === "active" ? "charts.green" : "charts.yellow"));
    item.contextValue = "person";
    const lines = [`**${p.user.displayName}** @${p.user.username}`, ""];
    if (p.task) lines.push(`Task: ${p.task.identifier} ${p.task.title}`);
    if (p.branch) lines.push(`Branch: \`${p.branch}\``);
    if (p.filePath) lines.push(`File: \`${p.filePath}\``);
    lines.push(`${p.state === "active" ? "Active" : "Idle"}, here for ${since(p.since)}`);
    item.tooltip = new vscode.MarkdownString(lines.join("  \n"));
    return item;
  }

  getChildren(n?: TeamNode): TeamNode[] {
    if (n?.kind === "project") return n.group.people.map((person) => ({ kind: "person", person, project: n.group.project }));
    if (n) return [];
    if (!this.session.signedIn) return [];
    // Empty, so the view's welcome text explains who shows up here.
    return this.groups.map((group) => ({ kind: "project", group }));
  }
}
