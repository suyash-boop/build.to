import * as vscode from "vscode";

/**
 * VS Code Live Share, through the API its extension exports (the same call the vsls package makes,
 * without shipping that package). Null when Live Share is not installed or its API is disabled.
 */
export interface LiveShare {
  share(options?: { suppressNotification?: boolean }): Promise<vscode.Uri | null>;
  join(link: vscode.Uri): Promise<void>;
}

export const LIVE_SHARE_ID = "ms-vsliveshare.vsliveshare";
/** The Live Share API contract version this code is written against. */
const API_VERSION = "1.0.4753";

export async function getLiveShare(): Promise<LiveShare | null> {
  const ext = vscode.extensions.getExtension<{ getApi?(v: string, caller?: string): Promise<LiveShare | null>; getApiAsync?(v: string): Promise<LiveShare | null> }>(LIVE_SHARE_ID);
  if (!ext) return null;
  const api = ext.isActive ? ext.exports : await ext.activate();
  if (!api) return null;
  return api.getApi ? api.getApi(API_VERSION, "bld-t.bldt") : (api.getApiAsync?.(API_VERSION) ?? null);
}
