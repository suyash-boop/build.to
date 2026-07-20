import Link from "next/link";
import { getSession } from "@/lib/session";
import { UserMenu } from "./UserMenu";

const primaryLink =
  "inline-flex h-8 items-center justify-center rounded bg-brand px-3 text-s font-medium text-white transition-colors hover:bg-brand-hover";

// The authenticated shell's top bar (PRD §8.6 — sticky, full-width, bottom
// border). Renders the user menu when signed in, a log-in link otherwise.
export async function Header() {
  const session = await getSession();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-body-bg">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="text-l font-bold text-body">
          build.to
        </Link>

        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <Link href="/new" className={primaryLink}>
                Write a post
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
