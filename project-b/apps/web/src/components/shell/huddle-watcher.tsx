"use client";

import type { HuddleItem } from "@bldt/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { http } from "@/lib/api.client";

/**
 * Shows a toast with a Join button when a teammate invites you to a huddle or a pairing session.
 * The invite arrives as a notification; the realtime bridge refetches ["me", "huddles"] on it.
 */
export function HuddleWatcher({ viewerId }: { viewerId: string }) {
  const { data } = useQuery({
    queryKey: ["me", "huddles"],
    queryFn: () => http.get<{ items: HuddleItem[] }>("/me/huddles").then((r) => r.items),
    staleTime: 10_000,
  });
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data) return;
    // The first load is history, not news.
    if (seen.current === null) {
      seen.current = new Set(data.map((h) => h.id));
      return;
    }
    for (const h of data) {
      if (seen.current.has(h.id)) continue;
      seen.current.add(h.id);
      if (h.host.id === viewerId || !h.active) continue;
      const what = h.kind === "PAIR" ? "pair in VS Code" : "join a huddle";
      toast(`${h.host.displayName} invites you to ${what}`, {
        description: [h.project.name, h.topic].filter(Boolean).join(" · "),
        duration: 60_000,
        action: { label: h.kind === "PAIR" ? "Open in VS Code" : "Join", onClick: () => window.open(h.url, "_blank", "noopener") },
      });
    }
  }, [data, viewerId]);

  return null;
}
