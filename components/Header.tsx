import Link from "next/link";
import { getSession } from "@/lib/session";
import { getUnreadCount } from "@/app/actions/notifications";
import { UserMenu } from "./UserMenu";
import { Logo } from "./Logo";

const primaryLink =
  "inline-flex h-9 items-center justify-center rounded-large bg-brand px-3 text-s font-medium text-white transition-colors hover:bg-brand-hover";

// The authenticated shell's top bar (PRD §8.6 — sticky, full-width, bottom
// border). Renders the user menu when signed in, a log-in link otherwise.
export async function Header() {
  const session = await getSession();
  const user = session?.user;
  const unread = user ? await getUnreadCount() : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-body-bg">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>

        <form action="/search" className="hidden max-w-lg flex-1 sm:block">
          <input
            type="search"
            name="q"
            placeholder="Search"
            aria-label="Search posts"
            className="h-9 w-full rounded-large border border-border bg-body-bg px-3 text-s text-body placeholder:text-secondary focus-visible:outline-2 focus-visible:outline-brand"
          />
        </form>

        <nav className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
          {user ? (
            <>
              <Link href="/new" className={primaryLink}>
                Write a post
              </Link>
              <Link
                href="/notifications"
                aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
                className="relative flex size-9 items-center justify-center rounded-large text-secondary transition-colors hover:bg-base-bg hover:text-body"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unread > 0 && (
                  <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <UserMenu
                name={user.name}
                username={user.username ?? null}
                image={user.image ?? null}
              />
            </>
          ) : (
            <Link href="/login" className={primaryLink}>
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
