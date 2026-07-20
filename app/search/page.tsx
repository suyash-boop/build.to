import type { Metadata } from "next";
import { countSearchResults, searchPosts } from "@/lib/search";
import { PostCard, type PostCardData } from "@/components/post/PostCard";
import { Pagination } from "@/components/Pagination";
import { EmptyState, Input } from "@/components/ui";
import { POSTS_PER_PAGE } from "@/lib/feed";

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: PageProps) {
  const { q = "", page: pageParam } = await searchParams;
  const query = q.trim();
  const page = Math.max(1, Number(pageParam) || 1);

  const [results, total] = query
    ? await Promise.all([
        searchPosts(query, POSTS_PER_PAGE, (page - 1) * POSTS_PER_PAGE),
        countSearchResults(query),
      ])
    : [[], 0];

  const posts: PostCardData[] = results.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    description: r.description,
    coverImage: r.coverImage,
    readingTime: r.readingTime,
    reactionsCount: r.reactionsCount,
    commentsCount: r.commentsCount,
    publishedAt: r.publishedAt,
    author: {
      name: r.authorName,
      username: r.authorUsername,
      image: r.authorImage,
    },
  }));

  const totalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <form action="/search" className="mb-5">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search posts"
          aria-label="Search posts"
        />
      </form>

      {!query ? (
        <EmptyState
          title="Search posts"
          description="Type a word or phrase to find posts by title or content."
        />
      ) : total === 0 ? (
        <EmptyState
          title={`No results for “${query}”`}
          description="Try a different word, or fewer of them."
        />
      ) : (
        <>
          <p className="mb-4 text-s text-secondary">
            {total} {total === 1 ? "result" : "results"} for &ldquo;{query}
            &rdquo;
          </p>
          <ul className="flex flex-col gap-4">
            {posts.map((post) => (
              <li key={post.id}>
                <PostCard post={post} />
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            totalPages={totalPages}
            basePath="/search"
            params={{ q: query }}
          />
        </>
      )}
    </main>
  );
}
