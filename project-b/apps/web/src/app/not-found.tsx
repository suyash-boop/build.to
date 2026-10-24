import Link from "next/link";
import { Wordmark } from "@/components/domain/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="px-5 py-4">
        <Link href="/" className="inline-block rounded-md">
          <Wordmark />
        </Link>
      </div>
      <main className="flex flex-1 items-center justify-center px-4 pb-24">
        <div className="max-w-sm text-center">
          <p className="font-mono text-xs text-faint">404</p>
          <h1 className="mt-2 text-lg font-semibold">This page does not exist, or you do not have access</h1>
          <p className="mt-2 text-sm text-muted">
            Private projects look the same as missing ones to anyone who is not a member. If you expected to see something here, ask the owner for
            an invitation.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild variant="primary" size="sm">
              <Link href="/">Go to Home</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/discover">Discover projects</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
