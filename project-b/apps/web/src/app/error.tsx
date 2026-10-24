"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-[70dvh] items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Something went wrong loading this page</h1>
        <p className="mt-2 text-sm text-muted">Try again. If it keeps happening, include the reference below when you contact us.</p>
        {error.digest && <p className="mt-3 font-mono text-xs text-faint">Reference {error.digest}</p>}
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" size="sm" onClick={reset}>Try again</Button>
          {/* "/" sends signed-in people on to /home and shows everyone else the landing page. */}
          <Button asChild size="sm" variant="ghost">
            <Link href="/">Go to Home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
