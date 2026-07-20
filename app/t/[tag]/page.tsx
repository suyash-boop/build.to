import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getLatestFeed } from "@/lib/feed";
import { PostCard } from "@/components/post/PostCard";
import { Pagination } from "@/components/Pagination";
import { Card, EmptyState } from "@/components/ui";

interface PageProps {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${tag}` };
}

export default async function TagPage({ params, searchParams }: PageProps) {
  const { tag: tagParam } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const tagName = tagParam.toLowerCase();

  const tag = await prisma.tag.findUnique({ where: { name: tagName } });
  if (!tag) notFound();

  const feed = await getLatestFeed(page, tagName);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Card
        className="mb-5 border-t-4 p-5"
        style={{ borderTopColor: tag.bgColorHex }}
      >
        <h1 className="text-2xl font-bold">#{tag.name}</h1>
        <p className="mt-1 text-s text-secondary">
          {tag.postsCount} {tag.postsCount === 1 ? "post" : "posts"}
        </p>
      </Card>

      {feed.posts.length === 0 ? (
        <EmptyState
          title={`No posts tagged #${tag.name} yet`}
          description="Once someone publishes with this tag, it shows up here."
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
            basePath={`/t/${tag.name}`}
          />
        </>
      )}
    </main>
  );
}
