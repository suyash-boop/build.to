import Link from "next/link";
import { getLatestFeed, getPopularTags } from "@/lib/feed";
import { getSession } from "@/lib/session";
import { PostCard } from "@/components/post/PostCard";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/ui";
import { LeftRail } from "@/components/feed/LeftRail";
import { PopularTags } from "@/components/feed/PopularTags";

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function Home({ searchParams }: PageProps) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [feed, session, tags] = await Promise.all([
    getLatestFeed(page),
    getSession(),
    getPopularTags(),
  ]);

  return (
    // Three-column layout (PRD §8.6): left rail + main + right rail on desktop,
    // main + right rail on tablet, single column on mobile.
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[200px_1fr_260px] md:grid-cols-[1fr_260px]">
      <aside className="hidden lg:block">
        <LeftRail />
      </aside>

      <main className="min-w-0">
        <h1 className="mb-4 text-xl font-bold">Latest</h1>

        {feed.posts.length === 0 ? (
          <EmptyState
            title="No posts yet"
            description={
              session ? "Write the first one." : "Sign in to write the first one."
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

      <aside className="hidden md:block">
        <PopularTags tags={tags} />
      </aside>
    </div>
  );
}
