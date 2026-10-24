import * as vscode from "vscode";
import { AskCodeActions, askTeam, type AskArgs } from "./ask.ts";
import { LiveNotifications, pair, startHuddle, type PersonTarget } from "./collab.ts";
import { gitApi } from "./git.ts";
import { Presence } from "./presence.ts";
import { Session } from "./session.ts";
import { openStream } from "./sse.ts";
import { CurrentTask, startTask, taskActions, taskWebUrl } from "./tasks.ts";
import { coalesce } from "./util.ts";
import { TasksView, TeamView, type MyTask, type TeamNode } from "./views.ts";
import { Workspace } from "./workspace.ts";

let activePresence: Presence | null = null;

/**
 * Everything is registered before the first await: if anything awaited later fails (git disabled,
 * keychain unavailable), the commands and views still exist and can say what is wrong.
 */
export async function activate(ctx: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("bld.t", { log: true });
  const session = new Session(ctx);
  const workspace = new Workspace(session);
  const tasks = new TasksView(session);
  const team = new TeamView(session);
  const current = new CurrentTask(session, workspace);
  const notes = new LiveNotifications(ctx, session);
  const presence = new Presence(ctx, session, workspace, (o, project) => {
    void vscode.window
      .showWarningMessage(
        `bld.t: ${o.user.displayName} is also editing ${o.filePath}${o.branch ? ` on ${o.branch}` : ""}${o.sameBranch ? " (same branch)" : ""}. Talk before you both push.`,
        "Huddle",
        "Pair",
      )
      .then((pick) => {
        const target: PersonTarget = { person: { user: o.user }, project: { ownerUsername: project.owner, slug: project.slug } };
        if (pick === "Huddle") void startHuddle(session, workspace, team, target);
        if (pick === "Pair") void pair(session, target);
      });
  });

  const refreshAll = () => {
    void tasks.refresh();
    void team.refresh();
    void current.refresh(true);
  };
  // A flapping connection reconnects many times; refetch once it settles, at most every 15 seconds.
  const afterReconnect = coalesce(
    () => {
      refreshAll();
      void notes.check();
    },
    2_000,
    15_000,
  );

  // ── Live updates ───────────────────────────────────────────
  let stopStream: (() => void) | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const queued = new Set<string>();
  const flush = () => {
    pending = null;
    if (queued.has("tasks")) void tasks.refresh();
    if (queued.has("current")) void current.refresh(true);
    if (queued.has("team")) void team.refresh();
    if (queued.has("notes")) void notes.check();
    queued.clear();
  };
  const queue = (...what: string[]) => {
    for (const w of what) queued.add(w);
    pending ??= setTimeout(flush, 400);
  };
  const startStream = () => {
    stopStream?.();
    stopStream = openStream({
      url: `${session.api.base}/api/realtime`,
      headers: () => session.authHeaders(),
      log: (m) => log.info(m),
      onReconnect: afterReconnect,
      // A 401 from /me signs out (which stops the stream); otherwise the stream retries on its own.
      onUnauthorized: () => void session.api.get("/me").catch(() => {}),
      onEvent: (e) => {
        if (e.event !== "change") return;
        let changes: { k: string }[] = [];
        try {
          changes = JSON.parse(e.data);
        } catch {
          return;
        }
        for (const c of changes) {
          if (c.k === "task" || c.k === "milestone") queue("tasks", "current");
          else if (c.k === "presence") queue("team");
          else if (c.k === "notification") queue("notes", "tasks");
          else if (c.k === "projects" || c.k === "member" || c.k === "project") {
            workspace.invalidate();
            queue("tasks", "team", "current");
          } else if (c.k === "resync") queue("tasks", "team", "current", "notes");
        }
      },
    });
  };

  const onSession = (signedIn: boolean) => {
    workspace.invalidate();
    refreshAll();
    if (signedIn) {
      startStream();
      presence.start();
      void notes.check();
    } else {
      stopStream?.();
      stopStream = null;
      presence.stop();
      current.item.hide();
    }
  };

  ctx.subscriptions.push(
    log,
    session,
    current,
    presence,
    session.onDidChange((u) => onSession(u !== null)),
    vscode.window.registerTreeDataProvider("bldt.tasks", tasks),
    vscode.window.registerTreeDataProvider("bldt.team", team),
    vscode.window.onDidChangeActiveTextEditor(() => void current.refresh()),
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new AskCodeActions(), { providedCodeActionKinds: AskCodeActions.kinds }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // A different address ends the session (the token stays with the server that issued it).
      if (e.affectsConfiguration("bldt.url")) void session.checkOrigin().then((ok) => ok && onSession(session.signedIn));
      if (e.affectsConfiguration("bldt.presence")) void presence.beat();
    }),

    vscode.commands.registerCommand("bldt.signIn", () => session.signIn()),
    vscode.commands.registerCommand("bldt.signOut", async () => {
      await presence.leave({ force: true });
      await session.signOut();
    }),
    vscode.commands.registerCommand("bldt.refresh", refreshAll),
    vscode.commands.registerCommand("bldt.taskActions", (t: MyTask) => taskActions(session, workspace, t, refreshAll)),
    vscode.commands.registerCommand("bldt.startTask", async (node?: { task: MyTask }) => {
      const t =
        node?.task ??
        (
          await vscode.window.showQuickPick(
            tasks.tasks.map((x) => ({ label: `${x.identifier} ${x.title}`, description: x.project.name, x })),
            { title: "Start which task?" },
          )
        )?.x;
      if (t) await startTask(session, workspace, t, refreshAll);
    }),
    vscode.commands.registerCommand("bldt.currentTask", async () => {
      if (current.task) await taskActions(session, workspace, current.task, refreshAll);
    }),
    vscode.commands.registerCommand("bldt.openInBrowser", (node?: { task: MyTask }) => {
      if (node?.task) void vscode.env.openExternal(vscode.Uri.parse(taskWebUrl(session, node.task)));
    }),
    vscode.commands.registerCommand("bldt.askTeam", (args?: AskArgs) => askTeam(session, workspace, args)),
    vscode.commands.registerCommand("bldt.huddle", (node?: TeamNode) => startHuddle(session, workspace, team, node?.kind === "person" ? node : undefined)),
    vscode.commands.registerCommand("bldt.pair", (node?: TeamNode) => pair(session, node?.kind === "person" ? node : undefined)),
    vscode.commands.registerCommand("bldt.toggleInvisible", async () => {
      await presence.setInvisible(!presence.invisible);
      vscode.window.setStatusBarMessage(presence.invisible ? "$(eye-closed) bld.t: you are invisible" : "$(eye) bld.t: teammates can see you again", 4000);
    }),
    {
      dispose: () => {
        stopStream?.();
        if (pending) clearTimeout(pending);
        afterReconnect.cancel();
      },
    },
    // vscode://bld-t.bldt/connect?code=... from the Connect VS Code button on bld.t.
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        if (uri.path !== "/connect") return;
        const code = new URLSearchParams(uri.query).get("code");
        if (code && /^[\w-]{20,100}$/.test(code)) void session.connectFromLink(code);
      },
    }),
  );

  // Team presence goes quiet without events (a laptop sleeps); recheck now and then.
  const teamTimer = setInterval(() => session.signedIn && void team.refresh(), 60_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(teamTimer) });
  activePresence = presence;

  // Watch branch switches in every repository.
  void gitApi().then((git) => {
    const watched = new WeakSet<object>();
    const watch = (repo: { state: { onDidChange: vscode.Event<void> } }) => {
      if (watched.has(repo)) return;
      watched.add(repo);
      let lastBranch: string | undefined;
      ctx.subscriptions.push(
        repo.state.onDidChange(() => {
          const name = (repo as { state: { HEAD?: { name?: string } } }).state.HEAD?.name;
          if (name === lastBranch) return;
          lastBranch = name;
          void current.refresh();
          presence.soon();
        }),
      );
    };
    git?.repositories.forEach(watch);
    if (git) ctx.subscriptions.push(git.onDidOpenRepository(watch));
  });

  await session.restore();

  // First run: offer sign-in once, instead of waiting to be found in the sidebar.
  if (!session.signedIn && !ctx.globalState.get<boolean>("bldt.welcomed")) {
    await ctx.globalState.update("bldt.welcomed", true);
    void vscode.window.showInformationMessage("bld.t is installed. Sign in to see your tasks and your team here.", "Sign in", "Show me around").then((pick) => {
      if (pick === "Sign in") void session.signIn();
      if (pick === "Show me around") void vscode.commands.executeCommand("workbench.action.openWalkthrough", "bld-t.bldt#bldt.start", false);
    });
  }
}

export function deactivate() {
  // Hand back presence if this window was the one sending. Entries expire on their own within
  // 90 seconds anyway, so shutdown never waits long for it.
  const p = activePresence;
  activePresence = null;
  if (!p) return;
  return Promise.race([p.closing(), new Promise<void>((r) => setTimeout(r, 2_000))]);
}
