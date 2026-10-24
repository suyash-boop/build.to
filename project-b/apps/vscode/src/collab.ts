import * as vscode from "vscode";
import { getLiveShare, LIVE_SHARE_ID } from "./liveshare.ts";
import type { Session } from "./session.ts";
import type { TeamView } from "./views.ts";
import type { Workspace } from "./workspace.ts";

export interface PersonTarget {
  person: { user: { id: string; displayName: string } };
  project: { slug: string; ownerUsername: string; name?: string };
}


/** Which project: the one this workspace belongs to, else ask among projects with people online. */
async function pickProject(workspace: Workspace, team: TeamView): Promise<{ owner: string; slug: string; name: string } | null> {
  const ctx = await workspace.current().catch(() => null);
  if (ctx?.project) return { owner: ctx.project.ownerUsername, slug: ctx.project.slug, name: ctx.project.name };
  if (team.groups.length === 0) {
    void vscode.window.showInformationMessage("bld.t: nobody is online in your projects right now.");
    return null;
  }
  const pick = await vscode.window.showQuickPick(
    team.groups.map((g) => ({ label: g.project.name, description: `${g.people.length} online`, g })),
    { title: "Huddle in which project?" },
  );
  return pick ? { owner: pick.g.project.ownerUsername, slug: pick.g.project.slug, name: pick.g.project.name } : null;
}

export async function startHuddle(session: Session, workspace: Workspace, team: TeamView, target?: PersonTarget) {
  const project = target ? { owner: target.project.ownerUsername, slug: target.project.slug, name: target.project.name ?? target.project.slug } : await pickProject(workspace, team);
  if (!project) return;
  const topic = await vscode.window.showInputBox({ title: "Huddle topic (optional)", placeHolder: "What do you want to talk about?" });
  if (topic === undefined) return;
  try {
    const res = await session.api.post<{ huddle: { url: string }; invited: number }>(`/projects/${project.owner}/${project.slug}/huddles`, {
      ...(target ? { invitees: [target.person.user.id] } : {}),
      ...(topic.trim() ? { topic: topic.trim() } : {}),
    });
    void vscode.env.openExternal(vscode.Uri.parse(res.huddle.url));
    vscode.window.setStatusBarMessage(`$(device-camera-video) Huddle started; ${res.invited} invited`, 5000);
  } catch (err) {
    void vscode.window.showErrorMessage(`bld.t: ${(err as Error).message}`);
  }
}

/** Live coding: start a Live Share session and send the link to a teammate through bld.t. */
export async function pair(session: Session, target?: PersonTarget) {
  if (!target) {
    void vscode.window.showInformationMessage("bld.t: pick a teammate in the Team view, then choose Pair.");
    return;
  }
  const liveShare = await getLiveShare();
  if (!liveShare) {
    const install = await vscode.window.showInformationMessage("Pairing uses VS Code Live Share, which is not installed.", "Install Live Share");
    if (install) await vscode.commands.executeCommand("workbench.extensions.installExtension", LIVE_SHARE_ID);
    return;
  }
  const link = await liveShare.share({ suppressNotification: true });
  if (!link) return;
  try {
    await session.api.post(`/projects/${target.project.ownerUsername}/${target.project.slug}/huddles`, {
      kind: "PAIR",
      invitees: [target.person.user.id],
      url: link.toString(),
    });
    await vscode.env.clipboard.writeText(link.toString());
    void vscode.window.showInformationMessage(`Invited ${target.person.user.displayName} to pair. They get a Join button in VS Code and on bld.t. The link is also on your clipboard.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`bld.t: ${(err as Error).message}`);
  }
}

export async function joinPair(url: string) {
  const liveShare = await getLiveShare();
  if (liveShare) await liveShare.join(vscode.Uri.parse(url));
  else void vscode.env.openExternal(vscode.Uri.parse(url));
}

// ── Notifications from bld.t, as VS Code notifications ───────

interface Note {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

const SHOWN_KEY = "bldt.shownNotifications";

export class LiveNotifications {
  private readonly startedAt = Date.now();

  constructor(
    private ctx: vscode.ExtensionContext,
    private session: Session,
  ) {}

  async check() {
    if (!this.session.signedIn || !vscode.workspace.getConfiguration("bldt").get<boolean>("notifications")) return;
    let items: Note[];
    try {
      items = (await this.session.api.get<{ items: Note[] }>("/notifications?unread=true&limit=20")).items;
    } catch {
      return;
    }
    // Read the shown list now, not at startup: every open window runs this check, and another one
    // may have just shown these. Record before showing so the other windows skip them.
    const shown = new Set(this.ctx.globalState.get<string[]>(SHOWN_KEY) ?? []);
    // Only what arrived while (or shortly before) this window was open; the inbox has the rest.
    const fresh = items.filter((n) => !shown.has(n.id) && new Date(n.createdAt).getTime() > this.startedAt - 10 * 60_000).reverse().slice(-5);
    if (!fresh.length) return;
    for (const n of fresh) shown.add(n.id);
    await this.ctx.globalState.update(SHOWN_KEY, [...shown].slice(-500));
    for (const n of fresh) void this.show(n);
  }

  private web(path: string) {
    return vscode.Uri.parse(`${this.session.api.base}${path}`);
  }

  private async markRead(n: Note) {
    await this.session.api.post("/notifications/read", { ids: [n.id] }).catch(() => {});
  }

  private async show(n: Note) {
    const d = n.data as Record<string, string | number | null | undefined>;
    const project = d.ownerUsername && d.projectSlug ? `/${d.ownerUsername}/${d.projectSlug}` : "";
    const open = async (path: string, label = "Open") => {
      return { label, run: () => vscode.env.openExternal(this.web(path)) };
    };
    let message: string;
    let level: "info" | "warn" = "info";
    const actions: { label: string; run: () => unknown }[] = [];

    switch (n.type) {
      case "huddle.invite":
        message = `${d.host} invites you to ${d.kind === "PAIR" ? "pair in VS Code" : "a huddle"} (${d.projectName})${d.topic ? `: ${d.topic}` : ""}`;
        actions.push({ label: "Join", run: () => (d.kind === "PAIR" ? joinPair(String(d.url)) : vscode.env.openExternal(vscode.Uri.parse(String(d.url)))) });
        break;
      case "presence.overlap":
        level = "warn";
        message = `${d.who} is editing ${d.filePath} too${d.theirBranch ? ` on ${d.theirBranch}` : ""}. Coordinate before you both push.`;
        actions.push(await open(project, "Open project"));
        break;
      case "discussion.help":
        message = `${d.author} needs help in ${d.projectName}: ${d.title}`;
        actions.push(await open(`${project}/discussions/${d.number}`, "Help"));
        break;
      case "discussion.replied":
        message = `${d.author} replied to "${d.title}"`;
        actions.push(await open(`${project}/discussions/${d.number}`));
        break;
      case "discussion.answered":
        message = `Your reply was marked as the solution to "${d.title}"`;
        actions.push(await open(`${project}/discussions/${d.number}`));
        break;
      case "discussion.mentioned":
        message = `${d.author} mentioned you in "${d.title}"`;
        actions.push(await open(`${project}/discussions/${d.number}`));
        break;
      case "task.assigned":
        message = `You were assigned ${d.identifier} ${d.title}`;
        actions.push(await open(`${project}/tasks?task=${d.number}`));
        break;
      case "task.commented":
        message = `${d.author} commented on ${d.identifier} ${d.title}`;
        actions.push(await open(`${project}/tasks?task=${d.number}`));
        break;
      case "signal.raised":
        level = d.severity === "CRITICAL" ? "warn" : "info";
        message = `${d.projectName}: ${d.title}`;
        actions.push(await open(d.number ? `${project}/tasks?task=${d.number}` : project));
        break;
      default:
        return;
    }
    const show = level === "warn" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const pick = await show(`bld.t: ${message}`, ...actions.map((a) => a.label));
    const action = actions.find((a) => a.label === pick);
    if (action) {
      await action.run();
      await this.markRead(n);
    }
  }
}
