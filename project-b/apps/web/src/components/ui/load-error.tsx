"use client";

import { RefreshCw } from "lucide-react";
import { errorMessage } from "@/lib/api.client";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** A failed load, said plainly, with a retry. Use instead of an empty or endless loading state. */
export function LoadError({
  title = "Could not load this",
  error,
  onRetry,
  retrying,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-2 py-4 text-center", className)}>
      <p className="text-sm text-fg">{title}</p>
      {error != null && <p className="max-w-sm text-xs text-muted">{errorMessage(error)}</p>}
      <Button size="xs" onClick={onRetry} loading={retrying}>
        <RefreshCw className="size-3" /> Try again
      </Button>
    </div>
  );
}
