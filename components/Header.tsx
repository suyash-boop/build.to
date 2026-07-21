import Link from "next/link";
import { getSession } from "@/lib/session";
import { getUnreadCount } from "@/app/actions/notifications";
import { UserMenu } from "./UserMenu";

const primaryLink =
  "inline-flex h-8 items-center justify-center rounded bg-brand px-3 text-s font-medium text-white transition-colors hover:bg-brand-hover";

// The authenticated shell's top bar (PRD §8.6 — sticky, full-width, bottom
// border). Renders the user menu when signed in, a log-in link otherwise.
export async function Header() {
  const session = await getSession();
  const user = session?.user;
  const unread = user ? await getUnreadCount() : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-body-bg">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex flex-1 items-center gap-4">
          <Link href="/" className="text-l font-bold text-body">
            build.to
          </Link>
          <form action="/search" className="hidden max-w-xs flex-1 sm:block">
            <input
              type="search"
              name="q"
              placeholder="Search"
              aria-label="Search posts"
              className="w-full rounded border border-border bg-body-bg px-3 py-1.5 text-s text-body placeholder:text-secondary focus-visible:outline-2 focus-visible:outline-brand"
            />
          </form>
        </div>

        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <Link href="/new" className={primaryLink}>
                Write a post
              </Link>
              <Link
                href="/notifications"
                aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
                className="relative flex size-8 items-center justify-center rounded text-secondary transition-colors hover:bg-base-bg hover:text-body"
              >
                <span aria-hidden className="text-l">
                  🔔
                </span>
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
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
