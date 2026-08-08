"use client";

import { useEffect } from "react";

// Route-segment error boundary (PRD §8.8: errors state what happened and what
// to do, without apologizing or being vague).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-l font-bold text-body">Something broke on this page</h1>
      <p className="text-secondary">
        This is on us, not you. Try again — if it keeps happening, the issue is
        being logged.
      </p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-9 items-center justify-center rounded bg-brand px-4 text-s font-medium text-white transition-colors hover:bg-brand-hover"
      >
        Try again
      </button>
    </main>
  );
}
