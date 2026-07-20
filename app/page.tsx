import Link from "next/link";
import { getLatestFeed } from "@/lib/feed";
import { getSession } from "@/lib/session";
import { PostCard } from "@/components/post/PostCard";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/ui";

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function Home({ searchParams }: PageProps) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [feed, session] = await Promise.all([
    getLatestFeed(page),
    getSession(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">Latest</h1>

      {feed.posts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          description={
            session
              ? "Write the first one."
              : "Sign in to write the first one."
          }
          action={
            <Link
              href={session ? "/new" : "/login"}
              className="inline-flex h-9 items-center justify-center rounded bg-brand px-4 text-s font-medium text-white transition-colors hover:bg-brand-hover"
            >
              {session ? "Write a post" : "Log in"}
            </Link>
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {feed.posts.map((post) => (
              <li key={post.id}>
                <PostCard post={post} />
              </li>
            ))}
          </ul>
          <Pagination
            page={feed.page}
            totalPages={feed.totalPages}
            basePath="/"
          />
        </>
      )}
    </main>
  );
}
