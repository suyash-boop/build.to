import * as vscode from "vscode";

/** The slice of the built-in git extension's API (vscode.git, API version 1) that bld.t uses. */
export interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD: { name?: string; commit?: string } | undefined;
    remotes: { name: string; fetchUrl?: string; pushUrl?: string }[];
    onDidChange: vscode.Event<void>;
  };
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  checkout(treeish: string): Promise<void>;
  getBranch(name: string): Promise<{ name?: string }>;
}

interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  getRepository(uri: vscode.Uri): GitRepository | null;
}

let cached: GitApi | null | undefined;

export async function gitApi(): Promise<GitApi | null> {
  if (cached !== undefined) return cached;
  const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>("vscode.git");
  if (!ext) return (cached = null);
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    cached = exports.getAPI(1);
  } catch {
    // getAPI throws when git is disabled (git.enabled: false); everything else works without branches.
    cached = null;
  }
  return cached;
}

/** The repository for the active editor, or the only one open. */
export async function activeRepository(): Promise<GitRepository | null> {
  const api = await gitApi();
  if (!api) return null;
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (uri && uri.scheme === "file") {
    const repo = api.getRepository(uri);
    if (repo) return repo;
  }
  return api.repositories.length === 1 ? api.repositories[0]! : (api.repositories[0] ?? null);
}

export function originUrl(repo: GitRepository): string | null {
  const remotes = repo.state.remotes;
  const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
  return origin?.fetchUrl ?? origin?.pushUrl ?? null;
}
