import * as vscode from "vscode";
import { activeRepository, originUrl, type GitRepository } from "./git.ts";
import type { Session } from "./session.ts";
import { identifierFromBranch, parseGithubRemote, relativePath } from "./util.ts";

export interface ProjectRef {
  name: string;
  slug: string;
  key: string;
  ownerUsername: string;
}

export interface WorkContext {
  repo: GitRepository;
  fullName: string;
  project: ProjectRef | null;
  branch: string | null;
  commit: string | null;
  /** Task number parsed from the branch name, when it names one of this project's tasks. */
  taskNumber: number | null;
  /** Active file, relative to the repository root. */
  filePath: string | null;
}

/** Maps the open git repository to the bld.t project it is connected to (cached per repo). */
export class Workspace {
  private cache = new Map<string, { at: number; project: ProjectRef | null }>();

  constructor(private session: Session) {}

  async projectFor(fullName: string): Promise<ProjectRef | null> {
    const hit = this.cache.get(fullName.toLowerCase());
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.project;
    const res = await this.session.api.get<{ items: ProjectRef[] }>(`/me/repo-projects?fullName=${encodeURIComponent(fullName)}`);
    const project = res.items[0] ?? null;
    this.cache.set(fullName.toLowerCase(), { at: Date.now(), project });
    return project;
  }

  invalidate() {
    this.cache.clear();
  }

  async current(): Promise<WorkContext | null> {
    if (!this.session.signedIn) return null;
    const repo = await activeRepository();
    if (!repo) return null;
    const url = originUrl(repo);
    const fullName = url ? parseGithubRemote(url) : null;
    if (!fullName) return null;
    let project: ProjectRef | null = null;
    try {
      project = await this.projectFor(fullName);
    } catch {
      return null;
    }
    const branch = repo.state.HEAD?.name ?? null;
    const editor = vscode.window.activeTextEditor;
    const filePath = editor && editor.document.uri.scheme === "file" ? relativePath(repo.rootUri.fsPath, editor.document.uri.fsPath) : null;
    const id = branch && project ? identifierFromBranch(branch, [project.key]) : null;
    return { repo, fullName, project, branch, commit: repo.state.HEAD?.commit ?? null, taskNumber: id?.number ?? null, filePath };
  }
}
