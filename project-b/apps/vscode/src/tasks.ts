import * as vscode from "vscode";
import type { Session } from "./session.ts";
import { branchName } from "./util.ts";
import { STATUS_LABEL, type MyTask, type Status } from "./views.ts";
import type { Workspace } from "./workspace.ts";

interface TaskDetail {
  number: number;
  identifier: string;
  title: string;
  status: Status;
  assignee: { id: string } | null;
}

type TaskRef = Pick<MyTask, "number" | "identifier" | "title"> & { project: { slug: string; ownerUsername: string } };

const taskPath = (t: TaskRef) => `/projects/${t.project.ownerUsername}/${t.project.slug}/tasks/${t.number}`;
export const taskWebUrl = (session: Session, t: TaskRef) => `${session.api.base}/${t.project.ownerUsername}/${t.project.slug}/tasks?task=${t.number}`;

/**
 * Start working on a task: assign it to yourself if nobody has it, move it to In progress, and
 * create (or switch to) a branch whose name carries the task id, so the pull request links itself.
 * The task is updated first: a branch for a task you could not take (no access, taken meanwhile)
 * would be misleading, while a failed branch after a successful update is easy to retry.
 */
export async function startTask(session: Session, workspace: Workspace, t: TaskRef, after: () => void) {
  const me = session.user!;
  const branch = branchName(me.username, t.identifier, t.title);

  try {
    const detail = await session.api.get<TaskDetail>(taskPath(t));
    const patch: Record<string, unknown> = {};
    if (!detail.assignee) patch.assigneeId = me.id;
    if (detail.status === "BACKLOG" || detail.status === "TODO") patch.status = "IN_PROGRESS";
    if (Object.keys(patch).length) await session.api.patch(taskPath(t), patch);
  } catch (err) {
    void vscode.window.showErrorMessage(`bld.t: ${(err as Error).message}`);
    return;
  }
  after();

  const ctx = await workspace.current().catch(() => null);
  const here = ctx?.project && ctx.project.slug === t.project.slug && ctx.project.ownerUsername === t.project.ownerUsername;
  if (here && ctx) {
    try {
      const exists = await ctx.repo.getBranch(branch).then(
        () => true,
        () => false,
      );
      if (exists) await ctx.repo.checkout(branch);
      else await ctx.repo.createBranch(branch, true);
    } catch (err) {
      void vscode.window.showErrorMessage(`bld.t: started ${t.identifier}, but could not switch to ${branch}: ${(err as Error).message}`);
      return;
    }
  } else {
    await vscode.env.clipboard.writeText(branch);
  }
  void vscode.window.showInformationMessage(
    here ? `Started ${t.identifier} on branch ${branch}.` : `Started ${t.identifier}. This workspace is not that project's repository, so the branch name was copied: ${branch}`,
  );
}

export async function setStatus(session: Session, t: TaskRef, status: Status, after: () => void) {
  try {
    await session.api.patch(taskPath(t), { status });
    after();
    vscode.window.setStatusBarMessage(`$(check) ${t.identifier} moved to ${STATUS_LABEL[status].toLowerCase()}`, 4000);
  } catch (err) {
    void vscode.window.showErrorMessage(`bld.t: ${(err as Error).message}`);
  }
}

export async function taskActions(session: Session, workspace: Workspace, t: TaskRef & { status?: Status }, after: () => void) {
  type Item = vscode.QuickPickItem & { run: () => unknown };
  const items: Item[] = [];
  if (t.status !== "IN_PROGRESS") items.push({ label: "$(play) Start", description: "Branch, assign to me, move to In progress", run: () => startTask(session, workspace, t, after) });
  if (t.status !== "IN_REVIEW") items.push({ label: "$(eye) Move to In review", run: () => setStatus(session, t, "IN_REVIEW", after) });
  if (t.status !== "DONE") items.push({ label: "$(pass) Mark done", run: () => setStatus(session, t, "DONE", after) });
  items.push({ label: "$(git-branch) Copy branch name", run: () => vscode.env.clipboard.writeText(branchName(session.user!.username, t.identifier, t.title)) });
  items.push({ label: "$(link-external) Open in bld.t", run: () => vscode.env.openExternal(vscode.Uri.parse(taskWebUrl(session, t))) });
  const pick = await vscode.window.showQuickPick(items, { title: `${t.identifier} ${t.title}`, placeHolder: t.status ? STATUS_LABEL[t.status] : undefined });
  await pick?.run();
}

/** The task for the current branch, in the status bar. Click for actions. */
export class CurrentTask implements vscode.Disposable {
  readonly item = vscode.window.createStatusBarItem("bldt.currentTask", vscode.StatusBarAlignment.Left, 50);
  task: (TaskRef & { status: Status }) | null = null;
  private lastKey = "";

  constructor(private session: Session, private workspace: Workspace) {
    this.item.name = "bld.t task";
    this.item.command = "bldt.currentTask";
  }

  async refresh(force = false) {
    const ctx = await this.workspace.current().catch(() => null);
    if (!ctx?.project || !ctx.taskNumber) {
      this.task = null;
      this.lastKey = "";
      this.item.hide();
      return;
    }
    const key = `${ctx.project.ownerUsername}/${ctx.project.slug}#${ctx.taskNumber}`;
    if (!force && key === this.lastKey && this.task) return;
    this.lastKey = key;
    const ref = { number: ctx.taskNumber, identifier: `${ctx.project.key}-${ctx.taskNumber}`, title: "", project: { slug: ctx.project.slug, ownerUsername: ctx.project.ownerUsername } };
    try {
      const d = await this.session.api.get<TaskDetail>(taskPath(ref));
      this.task = { ...ref, title: d.title, status: d.status };
      this.item.text = `$(tasklist) ${d.identifier} · ${STATUS_LABEL[d.status]}`;
      this.item.tooltip = `${d.identifier} ${d.title}\nClick for actions`;
      this.item.show();
    } catch {
      this.task = null;
      this.item.hide();
    }
  }

  dispose() {
    this.item.dispose();
  }
}
