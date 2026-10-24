"use client";

import { Code2, Download, ExternalLink, Plug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/misc";
import { errorMessage, http } from "@/lib/api.client";
import type { SessionRow } from "./account-settings";

export const EXTENSION_ID = "bld-t.bldt";

/**
 * Install and connect in two clicks. Install opens VS Code's own install page when the extension is
 * on the Marketplace (a download before that). Connect signs the editor in without codes: the
 * browser creates an approved one-time code and hands it to VS Code, which asks to confirm.
 */
export function EditorsSection({ sessions, published }: { sessions: SessionRow[]; published: boolean }) {
  const [connecting, setConnecting] = useState(false);
  const [hint, setHint] = useState(false);
  const editors = sessions.filter((s) => s.kind === "DEVICE");

  const connect = async () => {
    setConnecting(true);
    setHint(false);
    try {
      const { deviceCode } = await http.post<{ deviceCode: string }>("/auth/device/link", { clientName: "VS Code" });
      window.location.href = `vscode://${EXTENSION_ID}/connect?code=${encodeURIComponent(deviceCode)}`;
      // If VS Code (or the extension) is not installed, nothing visible happens; say what to do.
      setTimeout(() => setHint(true), 2500);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Editors</h2>
        <p className="mt-0.5 text-sm text-muted">Your tasks, your team, and help with errors inside VS Code. Install the extension, then connect it.</p>
      </div>
      <Panel className="divide-y divide-border">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <Code2 className="size-5 shrink-0 text-faint" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">VS Code</p>
            <p className="text-xs text-muted">Also installs in Cursor, Windsurf, and VSCodium; there, sign in from the bld.t view.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {published ? (
              <Button asChild size="sm">
                <a href={`vscode:extension/${EXTENSION_ID}`}>
                  <ExternalLink className="size-3.5" /> Install
                </a>
              </Button>
            ) : (
              <Button asChild size="sm">
                <a href="/projects/downloads/bldt.vsix" download>
                  <Download className="size-3.5" /> Download
                </a>
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={connect} loading={connecting}>
              <Plug className="size-3.5" /> Connect VS Code
            </Button>
          </div>
        </div>
        {!published && (
          <p className="px-4 py-2.5 text-xs text-muted">
            To install the download, drag <span className="font-mono">bldt.vsix</span> onto VS Code&apos;s Extensions view, then click Connect VS Code.
          </p>
        )}
        {hint && (
          <p className="px-4 py-2.5 text-xs text-muted">
            Nothing opened? Install the extension first, then click Connect again. Your browser may also ask to open VS Code; allow it.
          </p>
        )}
        {editors.length > 0 && (
          <ul className="px-4 py-2.5">
            {editors.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="size-1.5 rounded-full bg-success" aria-hidden />
                <span>{s.clientName ?? "Editor"}</span>
                <span className="text-xs text-faint">
                  connected <RelativeTime iso={s.createdAt} />
                  {s.lastSeenAt && (
                    <>
                      , active <RelativeTime iso={s.lastSeenAt} />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
