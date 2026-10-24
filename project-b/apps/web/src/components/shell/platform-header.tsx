import Link from "next/link";

/** Full document navigation across the two Next.js zones is intentional. */
export function PlatformHeader() {
  return (
    <header className="platform-header sticky top-0 z-40 border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-2 px-4 sm:gap-5 sm:px-6">
        <a href="/" className="text-lg font-extrabold tracking-tight text-fg" aria-label="build.to community">build<span className="text-primary">.to</span></a>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <nav aria-label="Platform" className="flex items-center gap-1 text-sm">
          <a href="/" className="rounded-lg px-2 py-2 text-muted hover:bg-surface-2 hover:text-fg sm:px-3">Community</a>
          <Link href="/home" className="rounded-lg bg-primary/10 px-2 py-2 font-semibold text-primary sm:px-3">Projects</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <a href="/new" className="hidden rounded-lg border border-border px-3 py-2 font-medium text-fg hover:border-primary sm:block">Write a post</a>
          <a href="/settings" className="rounded-lg px-3 py-2 text-muted hover:bg-surface-2 hover:text-fg">Account</a>
        </div>
      </div>
    </header>
  );
}
