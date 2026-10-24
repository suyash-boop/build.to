"use client";

import type { RealtimeChange } from "@bldt/contracts";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const LOCK = "bldt-realtime-leader";
const CHANNEL = "bldt-realtime";
/** Server components refetch at most this often while changes keep arriving. */
const REFRESH_MS = 800;

/** Which client caches each kind of change affects. Keys are [kind, owner, slug, ...]. */
const AFFECTS: Record<string, string[]> = {
  task: ["tasks", "task", "milestones"],
  comment: ["task"],
  milestone: ["milestones", "tasks"],
  activity: ["activity"],
  member: ["members", "tasks", "task"],
  project: ["tasks", "task", "milestones", "members", "activity"],
  signal: [],
  discussion: ["discussions", "discussion"],
  presence: ["presence"],
};

/** Server-rendered pages that show each kind; the board and lists use the query cache instead. */
const SERVER_RENDERED = /^\/[^/]+\/[^/]+(\/(insights|activity|releases|people))?\/?$/;

/**
 * Live updates. One tab per browser holds the stream (elected with the Web Locks API) and
 * relays changes to the others over BroadcastChannel, so ten open tabs cost one connection.
 * When the leader closes, another tab takes the lock and reconnects.
 */
export function RealtimeBridge() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let staleWhileHidden = false;

    const refresh = () => {
      if (document.hidden) {
        staleWhileHidden = true;
        return;
      }
      refreshTimer ??= setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, REFRESH_MS);
    };
    const onVisible = () => {
      if (!document.hidden && staleWhileHidden) {
        staleWhileHidden = false;
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const apply = (changes: RealtimeChange[]) => {
      const here = path.current;
      for (const c of changes) {
        if (c.k === "resync") {
          void qc.invalidateQueries();
          refresh();
          continue;
        }
        if (c.k === "notification") {
          void qc.invalidateQueries({ queryKey: ["me", "unread"] });
          void qc.invalidateQueries({ queryKey: ["notifications"] });
          void qc.invalidateQueries({ queryKey: ["me", "huddles"] });
          if (here === "/home") refresh();
          continue;
        }
        if (c.k === "projects") {
          void qc.invalidateQueries({ queryKey: ["me", "projects"] });
          if (here === "/home") refresh();
          continue;
        }
        if (!("project" in c)) continue;
        const { owner, slug } = c.project;
        const kinds = AFFECTS[c.k] ?? [];
        if (kinds.length) {
          void qc.invalidateQueries({
            predicate: (q: Query) => kinds.includes(q.queryKey[0] as string) && q.queryKey[1] === owner && q.queryKey[2] === slug,
          });
        }
        // Presence changes often (file switches); the presence query is enough, no page re-render.
        if (c.k === "presence") continue;
        if (c.k === "project" || c.k === "member") void qc.invalidateQueries({ queryKey: ["me", "projects"] });
        const inProject = here === `/${owner}/${slug}` || here.startsWith(`/${owner}/${slug}/`);
        if ((inProject && SERVER_RENDERED.test(here)) || (inProject && (c.k === "project" || c.k === "member")) || here === "/home") refresh();
      }
    };

    const bc = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    bc?.addEventListener("message", (e: MessageEvent<RealtimeChange[]>) => apply(e.data));

    let source: EventSource | null = null;
    let releaseLock: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;
    // Any ready after the first, native retry or ours, is a reconnect: changes in between were missed.
    let everReady = false;

    const publish = (changes: RealtimeChange[]) => {
      bc?.postMessage(changes);
      apply(changes);
    };

    const connect = () => {
      if (disposed) return;
      const es = new EventSource("/projects/api/realtime");
      source = es;
      es.addEventListener("ready", () => {
        attempt = 0;
        if (everReady) publish([{ k: "resync" }]);
        everReady = true;
      });
      es.addEventListener("change", (e) => {
        try {
          publish(JSON.parse((e as MessageEvent<string>).data) as RealtimeChange[]);
        } catch {
          // A malformed frame is skipped; the next change or resync recovers.
        }
      });
      es.onerror = () => {
        // The browser retries on its own while CONNECTING. CLOSED means it gave up (a 401 or 503):
        // back off and try again.
        if (es.readyState !== EventSource.CLOSED || disposed) return;
        es.close();
        const delay = Math.min(60_000, 2_000 * 2 ** attempt++);
        retry = setTimeout(connect, delay);
      };
    };

    const abort = new AbortController();
    if (typeof navigator !== "undefined" && navigator.locks) {
      navigator.locks
        .request(LOCK, { signal: abort.signal }, () => {
          connect();
          // Hold the lock for as long as this tab lives.
          return new Promise<void>((resolve) => (releaseLock = resolve));
        })
        .catch(() => {});
    } else {
      connect();
    }

    return () => {
      disposed = true;
      abort.abort();
      releaseLock?.();
      source?.close();
      if (retry) clearTimeout(retry);
      if (refreshTimer) clearTimeout(refreshTimer);
      bc?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qc, router]);

  return null;
}
