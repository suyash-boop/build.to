import * as vscode from "vscode";
import type { Session } from "./session.ts";
import { errorTitle, relativePath, snippet } from "./util.ts";
import type { Workspace } from "./workspace.ts";

interface Similar {
  project: { name: string; slug: string; ownerUsername: string };
  number: number;
  title: string;
  solved: boolean;
  answer: { excerpt: string; author: { displayName: string } } | null;
}

const MAX_ERROR_CHARS = 20_000;

export interface AskArgs {
  uri?: vscode.Uri;
  diagnostic?: vscode.Diagnostic;
}

/** Offers "Ask the team" on errors in any language. */
export class AskCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    return ctx.diagnostics
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
      .slice(0, 1)
      .map((diagnostic) => {
        const action = new vscode.CodeAction("Ask the team on bld.t", vscode.CodeActionKind.QuickFix);
        action.command = { command: "bldt.askTeam", title: "Ask the team", arguments: [{ uri: doc.uri, diagnostic } satisfies AskArgs] };
        action.diagnostics = [diagnostic];
        return action;
      });
  }
}

function diagnosticText(d: vscode.Diagnostic): string {
  const code = typeof d.code === "object" ? d.code.value : d.code;
  return `${d.source ? `${d.source}: ` : ""}${d.message}${code !== undefined && code !== "" ? ` (${code})` : ""}`;
}

/**
 * Capture the error with its real context (file, line, code, branch, commit), show the fix if the
 * team solved the same error before, otherwise post a help thread that notifies the team.
 */
export async function askTeam(session: Session, workspace: Workspace, args?: AskArgs) {
  const ctx = await workspace.current();
  if (!ctx?.project) {
    void vscode.window.showWarningMessage("bld.t: this workspace's GitHub repository is not connected to a bld.t project you are in.");
    return;
  }
  const editor = vscode.window.activeTextEditor;
  const doc = args?.uri ? await vscode.workspace.openTextDocument(args.uri) : editor?.document;

  // Where the error text comes from: the diagnostic, the selection, or the clipboard.
  let errorMessage = args?.diagnostic ? diagnosticText(args.diagnostic) : "";
  let line = args?.diagnostic ? args.diagnostic.range.start.line + 1 : undefined;
  if (!errorMessage && editor && !editor.selection.isEmpty) errorMessage = editor.document.getText(editor.selection);
  if (!errorMessage && editor) {
    const here = vscode.languages.getDiagnostics(editor.document.uri).find((d) => d.severity === vscode.DiagnosticSeverity.Error && d.range.contains(editor.selection.active));
    if (here) {
      errorMessage = diagnosticText(here);
      line = here.range.start.line + 1;
    }
  }
  if (!errorMessage) {
    const clip = (await vscode.env.clipboard.readText()).trim();
    const looksLikeError = /(error|exception|panic|traceback|failed|fatal)/i.test(clip) && clip.length < MAX_ERROR_CHARS;
    const typed = await vscode.window.showInputBox({
      title: "Ask the team",
      prompt: "Paste the error message or stack trace",
      value: looksLikeError ? clip : "",
      ignoreFocusOut: true,
    });
    if (!typed?.trim()) return;
    errorMessage = typed;
  }
  if (!line && editor && doc === editor.document) line = editor.selection.active.line + 1;
  // The server rejects longer errors; the start of a stack trace is the useful part.
  errorMessage = errorMessage.slice(0, MAX_ERROR_CHARS);

  const base = `/projects/${ctx.project.ownerUsername}/${ctx.project.slug}/discussions`;
  try {
    const similar = await session.api.post<{ items: Similar[] }>(`${base}/similar`, { errorMessage });
    if (similar.items.length) {
      type Item = vscode.QuickPickItem & { s?: Similar };
      const items: Item[] = [
        ...similar.items.map((s) => ({
          label: `${s.solved ? "$(pass-filled)" : "$(circle-outline)"} ${s.title}`,
          description: `${s.project.name} #${s.number}${s.solved ? " · solved" : ""}`,
          detail: s.answer ? `${s.answer.author.displayName}: ${s.answer.excerpt}` : undefined,
          s,
        })),
        { label: "$(comment-discussion) Ask the team anyway", alwaysShow: true },
      ];
      const pick = await vscode.window.showQuickPick(items, {
        title: similar.items.some((s) => s.solved) ? "Your team has solved this error before" : "This error has come up before",
        matchOnDetail: true,
        ignoreFocusOut: true,
      });
      if (!pick) return;
      if (pick.s) {
        void vscode.env.openExternal(vscode.Uri.parse(`${session.api.base}/${pick.s.project.ownerUsername}/${pick.s.project.slug}/discussions/${pick.s.number}`));
        return;
      }
    }
  } catch {
    // Similarity is a convenience; asking still works without it.
  }

  const title = await vscode.window.showInputBox({ title: "Ask the team: title", value: errorTitle(errorMessage), ignoreFocusOut: true, validateInput: (v) => (v.trim().length < 3 ? "At least 3 characters" : null) });
  if (!title) return;
  const body = await vscode.window.showInputBox({ title: "Ask the team: what were you trying to do? (optional)", ignoreFocusOut: true });
  if (body === undefined) return;

  // Relative to the repository root; files outside the repository are not described.
  const inRepo = doc && doc.uri.scheme === "file" ? (relativePath(ctx.repo.rootUri.fsPath, doc.uri.fsPath) ?? undefined) : undefined;
  try {
    const res = await session.api.post<{ discussion: { number: number } }>(base, {
      category: "HELP",
      title: title.trim(),
      body: body.trim(),
      error: {
        errorMessage,
        ...(doc ? { language: doc.languageId } : {}),
        ...(inRepo ? { filePath: inRepo } : {}),
        ...(line ? { line } : {}),
        ...(doc && line ? { codeSnippet: snippet(doc.getText(), line) } : {}),
        ...(ctx.branch ? { branch: ctx.branch } : {}),
        ...(ctx.commit ? { commitSha: ctx.commit } : {}),
      },
    });
    const url = `${session.api.base}/${ctx.project.ownerUsername}/${ctx.project.slug}/discussions/${res.discussion.number}`;
    const open = await vscode.window.showInformationMessage(`Asked in ${ctx.project.name}. Your team was notified.`, "Open");
    if (open) void vscode.env.openExternal(vscode.Uri.parse(url));
  } catch (err) {
    void vscode.window.showErrorMessage(`bld.t: ${(err as Error).message}`);
  }
}
