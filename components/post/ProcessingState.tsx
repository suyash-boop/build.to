"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui";

/**
 * Shown while a post's Markdown is still being rendered by the worker
 * (PRD §5.3). Normally sub-second, but the state has to be handled — the whole
 * point of moving rendering off the request path is that it may not be done yet.
 *
 * Polls by refreshing the server component every 2s until processingState
 * changes, at which point this component is no longer rendered.
 */
export function ProcessingState({ failed = false }: { failed?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (failed) return; // terminal — nothing to wait for
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [failed, router]);

  if (failed) {
    return (
      <div className="mt-8 rounded border border-danger px-4 py-3 text-danger">
        <p className="font-medium">This post could not be rendered.</p>
        <p className="mt-1 text-s">
          Open it in the editor and save again to retry.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8" aria-live="polite">
      <p className="mb-4 text-secondary">Rendering…</p>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
