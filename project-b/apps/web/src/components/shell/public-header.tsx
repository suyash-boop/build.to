import Link from "next/link";
import { Wordmark } from "@/components/domain/logo";
import { Button } from "@/components/ui/button";

export function PublicHeader({ next }: { next?: string }) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="rounded-md">
          <span className="text-sm font-semibold">Project discovery</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/discover" className="rounded-md px-2.5 py-1 text-sm text-muted hover:text-fg">
            Discover
          </Link>
          <Button asChild variant="primary" size="sm">
            <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Sign in</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
        <a href="/" className="font-semibold hover:text-primary">build.to · Back to the community ↗</a>
        <nav className="flex gap-4">
          <Link href="/discover" className="hover:text-fg">Discover</Link>
          <Link href="/privacy" className="hover:text-fg">Privacy</Link>
          <Link href="/terms" className="hover:text-fg">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
