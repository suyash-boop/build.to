import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { Session } from "./session.ts";
import type { Workspace } from "./workspace.ts";

const HEARTBEAT_MS = 30_000;
/** After this long without typing, switching files, or focusing the window, you show as idle. */
const IDLE_AFTER_MS = 5 * 60_000;
/** After this long idle, stop sending entirely: you drop off within the server's freshness window. */
const AWAY_AFTER_MS = 20 * 60_000;

/** Shared by every window (globalState): which window was focused last, and which one last sent. */
const FOCUS_KEY = "bldt.presence.focusedWindow";
const LAST_KEY = "bldt.presence.lastSender";
const INVISIBLE_KEY = "bldt.presence.invisible";
/** This window, for the keys above. */
const WINDOW_ID = randomUUID();

interface ProjectKey {
  owner: string;
  slug: string;
}

interface Overlap {
  user: { id: string; displayName: string };
  filePath: string;
  branch: string | null;
  sameBranch: boolean;
}

/**
 * Tells teammates what you are working on, at the level the person chose in settings, and warns
 * when someone else is in the same file. Nothing is sent while invisible or signed out.
 *
 * With several windows open, only the focused one (or the one focused most recently) sends, so a
 * background window on another project does not overwrite what you are actually doing. A window only
 * removes the entry it sent last itself, never one another window is keeping fresh.
 */
export class Presence implements vscode.Disposable {
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private lastActive = Date.now();
  private warned = new Set<string>();
  private inflight: Promise<void> | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private ctx: vscode.ExtensionContext,
    private session: Session,
    private workspace: Workspace,
    private onOverlap: (o: Overlap, project: ProjectKey) => void,
  ) {
    const touch = () => {
      this.lastActive = Date.now();
    };
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        touch();
        this.soon();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => e.document.uri.scheme === "file" && touch()),
      vscode.window.onDidChangeWindowState((s) => {
        if (!s.focused) return;
        touch();
        void this.claim().then(() => this.soon());
      }),
    );
  }

  /** Read from shared state each time, so hiding in one window hides every window. */
  get invisible(): boolean {
    return this.ctx.globalState.get<boolean>(INVISIBLE_KEY) ?? false;
  }

  async setInvisible(value: boolean) {
    await this.ctx.globalState.update(INVISIBLE_KEY, value);
    if (!value) return this.beat();
    // A heartbeat already on its way would land after the DELETE and show you again; remove it once more after.
    await this.inflight?.catch(() => {});
    await this.leave({ force: true });
  }

  start() {
    this.stop();
    if (vscode.window.state.focused || !this.ctx.globalState.get<string>(FOCUS_KEY)) void this.claim();
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_MS);
    void this.beat();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Branch switched or file changed: send now rather than at the next tick. */
  soon() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.beat(), 1500);
  }

  private claim() {
    return this.ctx.globalState.update(FOCUS_KEY, WINDOW_ID);
  }

  /** The window that speaks for you: focused now, or the last one that was. */
  private isActiveWindow() {
    return vscode.window.state.focused || this.ctx.globalState.get<string>(FOCUS_KEY) === WINDOW_ID;
  }

  private share(): "file" | "branch" | "off" {
    return vscode.workspace.getConfiguration("bldt").get<"file" | "branch" | "off">("presence.share") ?? "file";
  }

  beat(): Promise<void> {
    const run = this.send().finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async send() {
    if (!this.session.signedIn) return;
    // Another window is the one in use: stay quiet and leave what it keeps fresh alone.
    if (!this.isActiveWindow()) return;
    const share = this.share();
    const quietFor = Date.now() - this.lastActive;
    if (this.invisible || share === "off" || quietFor > AWAY_AFTER_MS) return this.leave();
    const ctx = await this.workspace.current().catch(() => null);
    if (!ctx?.project) return this.leave();
    const project = { owner: ctx.project.ownerUsername, slug: ctx.project.slug };
    // This window speaks for you now; an entry left by the previous sender for another project is stale.
    const last = this.lastSender();
    if (last && !sameProject(last, project)) await this.remove(last);
    const body = {
      ...project,
      state: quietFor > IDLE_AFTER_MS ? "idle" : "active",
      ...(ctx.branch ? { branch: ctx.branch } : {}),
      ...(share === "file" && ctx.filePath ? { filePath: ctx.filePath } : {}),
      ...(ctx.taskNumber ? { taskNumber: ctx.taskNumber } : {}),
      client: "vscode",
    };
    try {
      const res = await this.session.api.put<{ overlaps: Overlap[] }>("/me/presence", body);
      await this.ctx.globalState.update(LAST_KEY, { window: WINDOW_ID, ...project });
      // Toggled invisible (here or in another window) while this was on the wire.
      if (this.invisible) return this.leave({ force: true });
      if (this.warned.size > 500) this.warned.clear();
      for (const o of res.overlaps) {
        const key = `${o.user.id}:${o.filePath}`;
        if (this.warned.has(key)) continue;
        this.warned.add(key);
        this.onOverlap(o, project);
      }
    } catch {
      // Offline or server busy: try again next tick.
    }
  }

  private lastSender() {
    return this.ctx.globalState.get<ProjectKey & { window: string }>(LAST_KEY);
  }

  private remove(p: ProjectKey) {
    return this.session.api.del(`/me/presence?owner=${encodeURIComponent(p.owner)}&slug=${encodeURIComponent(p.slug)}`).then(
      () => {},
      () => {},
    );
  }

  /**
   * Tell the server right away instead of waiting for the entry to expire. Only the window that sent
   * last removes it (another window may be keeping it fresh), unless `force`: going invisible or
   * signing out applies to every window.
   */
  async leave(opts: { force?: boolean } = {}) {
    if (!this.session.signedIn) return;
    const last = this.lastSender();
    if (!last || (last.window !== WINDOW_ID && !opts.force)) return;
    await this.ctx.globalState.update(LAST_KEY, undefined);
    await this.remove(last);
  }

  /** This window is closing: hand back the entry only if it was the one sending. */
  async closing() {
    this.stop();
    await this.leave();
  }

  dispose() {
    this.stop();
    if (this.debounce) clearTimeout(this.debounce);
    for (const d of this.disposables) d.dispose();
  }
}

function sameProject(a: ProjectKey, b: ProjectKey) {
  return a.owner === b.owner && a.slug === b.slug;
}
