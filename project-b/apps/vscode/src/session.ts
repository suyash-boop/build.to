import * as os from "node:os";
import * as vscode from "vscode";
import { Api, ApiError, pollForToken, type DeviceCode, type SignedIn } from "./api.ts";
import { normalizeBaseUrl } from "./util.ts";

const TOKEN_KEY = "bldt.token";
const USER_KEY = "bldt.user";
/** The address that issued the token. A token is only ever sent back there. */
const TOKEN_ORIGIN_KEY = "bldt.tokenOrigin";

/** The configured bld.t address, or null when unset or not acceptable (http to a remote host, say). */
export function configuredBase(): string | null {
  const raw = vscode.workspace.getConfiguration("bldt").get<string>("url") ?? "";
  const res = normalizeBaseUrl(raw);
  return "url" in res ? res.url : null;
}

export type User = SignedIn["user"];

/**
 * Who is signed in. The token lives in VS Code's SecretStorage (the OS keychain), never in settings
 * or files. A 401 from the server (revoked in Settings, expired) signs out here too.
 */
export class Session implements vscode.Disposable {
  private token: string | null = null;
  private tokenOrigin: string | null = null;
  user: User | null = null;
  private readonly changed = new vscode.EventEmitter<User | null>();
  readonly onDidChange = this.changed.event;
  readonly api: Api;

  constructor(private ctx: vscode.ExtensionContext) {
    this.api = new Api({
      baseUrl: () => configuredBase() ?? "",
      token: () => this.currentToken(),
      onUnauthorized: () => void this.clear("Your bld.t sign-in expired or was revoked. Sign in again."),
      userAgent: `bldt-vscode/${ctx.extension.packageJSON.version} vscode/${vscode.version}`,
    });
  }

  /** The token, but only while the configured address is the one that issued it. */
  private currentToken(): string | null {
    return this.token && this.tokenOrigin && this.tokenOrigin === configuredBase() ? this.token : null;
  }

  async restore() {
    this.token = (await this.ctx.secrets.get(TOKEN_KEY)) ?? null;
    this.tokenOrigin = this.ctx.globalState.get<string>(TOKEN_ORIGIN_KEY) ?? null;
    this.user = this.token ? (this.ctx.globalState.get<User>(USER_KEY) ?? null) : null;
    await this.setContext();
    // A token without a recorded origin, or from another address, is not sent anywhere.
    if (this.token && !(await this.checkOrigin())) return;
    if (this.token) {
      // Confirm the token still works and refresh the cached profile.
      try {
        const me = await this.api.get<User>("/me");
        this.user = { id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl };
        await this.ctx.globalState.update(USER_KEY, this.user);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) {
          // Offline or server down: keep the session, it will be checked again on use.
        }
      }
    }
    this.changed.fire(this.user);
  }

  get signedIn() {
    return this.token !== null;
  }

  /**
   * After the address setting changes: a session belongs to the address that issued it, so a
   * different address ends it. Returns whether the session (if any) is still valid.
   */
  async checkOrigin(): Promise<boolean> {
    if (!this.token) return true;
    if (this.tokenOrigin && this.tokenOrigin === configuredBase()) return true;
    const old = this.tokenOrigin;
    const token = this.token;
    await this.clear();
    // Best effort: end the old session at the server that issued it, nowhere else.
    if (old) await this.revoke(token, old);
    void vscode.window.showInformationMessage("bld.t: your sign-in was for a different bld.t address, so you were signed out. Sign in again to continue.", "Sign in").then((pick) => {
      if (pick) void this.signIn();
    });
    return false;
  }

  /** The configured address, or ask for one (and save it) when it is missing or not allowed. */
  async ensureUrl(): Promise<string | null> {
    const current = configuredBase();
    if (current) return current;
    const raw = vscode.workspace.getConfiguration("bldt").get<string>("url") ?? "";
    const typed = await vscode.window.showInputBox({
      title: "bld.t address",
      prompt: raw ? `${raw} cannot be used. Enter the address you open bld.t at in your browser.` : "Enter the address you open bld.t at in your browser.",
      value: raw,
      ignoreFocusOut: true,
      validateInput: (v) => {
        const res = normalizeBaseUrl(v);
        return "error" in res ? res.error : null;
      },
    });
    if (typed === undefined) return null;
    const res = normalizeBaseUrl(typed);
    if ("error" in res) return null;
    await vscode.workspace.getConfiguration("bldt").update("url", res.url, vscode.ConfigurationTarget.Global);
    return res.url;
  }

  async signIn() {
    const base = await this.ensureUrl();
    if (!base) return;
    let code: DeviceCode;
    try {
      code = await this.api.request<DeviceCode>("POST", "/auth/device/code", { clientName: `VS Code on ${os.hostname()}`.slice(0, 80) }, { auth: false });
    } catch (err) {
      void vscode.window.showErrorMessage(`bld.t: ${(err as Error).message}`);
      return;
    }
    await vscode.env.clipboard.writeText(code.userCode);
    const signed = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "bld.t", cancellable: true },
      async (progress, token) => {
        progress.report({ message: `Approve code ${code.userCode} in your browser (copied to the clipboard).` });
        void vscode.env.openExternal(vscode.Uri.parse(code.verificationUriComplete));
        try {
          return await pollForToken(this.api, code, { cancelled: () => token.isCancellationRequested });
        } catch (err) {
          if (!(err instanceof ApiError) || err.code !== "cancelled") void vscode.window.showErrorMessage(`bld.t: ${(err as Error).message}`);
          return null;
        }
      },
    );
    if (!signed) return;
    await this.adopt(signed, base);
  }

  /**
   * "Connect VS Code" on the website opens vscode://bld-t.bldt/connect?code=... with an approved,
   * short-lived code. The account is confirmed before the session is kept: a link someone else sent
   * must not quietly sign this editor in as them.
   */
  async connectFromLink(deviceCode: string) {
    const base = await this.ensureUrl();
    if (!base) return;
    let signed: SignedIn;
    try {
      signed = await this.api.request<SignedIn>("POST", "/auth/device/token", { deviceCode }, { auth: false });
    } catch (err) {
      const pick = await vscode.window.showErrorMessage(`bld.t: ${(err as Error).message} Try Connect again, or sign in here.`, "Sign in");
      if (pick) await this.signIn();
      return;
    }
    if (this.user?.id === signed.user.id) {
      // Already this account: keep the existing session, drop the new one.
      await this.revoke(signed.accessToken, base);
      void vscode.window.showInformationMessage(`bld.t: already signed in as @${signed.user.username}.`);
      return;
    }
    const ok = await vscode.window.showInformationMessage(
      `Connect VS Code to bld.t as ${signed.user.displayName} (@${signed.user.username})?`,
      { modal: true, detail: "Only continue if you just clicked Connect VS Code on bld.t yourself." },
      "Connect",
    );
    if (ok !== "Connect") {
      await this.revoke(signed.accessToken, base);
      return;
    }
    if (this.token) await this.api.post("/auth/logout").catch(() => {});
    await this.adopt(signed, base);
  }

  /** Revoke a token at the address that issued it. */
  private async revoke(token: string, origin: string) {
    await fetch(`${origin}/projects/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }

  private async adopt(signed: SignedIn, origin: string) {
    this.token = signed.accessToken;
    this.tokenOrigin = origin;
    this.user = signed.user;
    await this.ctx.secrets.store(TOKEN_KEY, signed.accessToken);
    await this.ctx.globalState.update(TOKEN_ORIGIN_KEY, origin);
    await this.ctx.globalState.update(USER_KEY, signed.user);
    await this.setContext();
    this.changed.fire(this.user);
    void vscode.window.showInformationMessage(`bld.t: signed in as @${signed.user.username}.`);
  }

  async signOut() {
    if (this.token) await this.api.post("/auth/logout").catch(() => {});
    await this.clear();
  }

  private async clear(message?: string) {
    if (!this.token && !this.user) return;
    this.token = null;
    this.tokenOrigin = null;
    this.user = null;
    await this.ctx.secrets.delete(TOKEN_KEY);
    await this.ctx.globalState.update(TOKEN_ORIGIN_KEY, undefined);
    await this.ctx.globalState.update(USER_KEY, undefined);
    await this.setContext();
    this.changed.fire(null);
    if (message) {
      const pick = await vscode.window.showWarningMessage(message, "Sign in");
      if (pick) await this.signIn();
    }
  }

  /** For the live stream: the header to send, or null when signed out. */
  authHeaders(): Record<string, string> | null {
    const token = this.currentToken();
    return token ? { authorization: `Bearer ${token}` } : null;
  }

  private setContext() {
    return vscode.commands.executeCommand("setContext", "bldt.signedIn", this.token !== null);
  }

  dispose() {
    this.changed.dispose();
  }
}
