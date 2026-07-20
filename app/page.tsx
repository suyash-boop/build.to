import Link from "next/link";
import { getSession } from "@/lib/session";
import { EmptyState } from "@/components/ui";

export default async function Home() {
  const session = await getSession();

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      {session ? (
        <EmptyState
          title={`Signed in as ${session.user.username ? `@${session.user.username}` : session.user.name}`}
          description="The feed lands in a later phase. For now, this is the authenticated shell."
        />
      ) : (
        <EmptyState
          title="Welcome to build.to"
          description="A place to write and read technical posts."
          action={
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded bg-brand px-4 text-base font-medium text-white transition-colors hover:bg-brand-hover"
            >
              Log in
            </Link>
          }
        />
      )}
    </main>
  );
}
