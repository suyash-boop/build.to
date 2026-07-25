import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicPost } from "@/lib/post";
import { incrementViews } from "@/lib/cache";
import { getSession } from "@/lib/session";
import { Avatar, Card, Tag } from "@/components/ui";
import { ProcessingState } from "@/components/post/ProcessingState";
import { ReactionBar } from "@/components/post/ReactionBar";
import { FollowButton } from "@/components/FollowButton";
import { CommentThread } from "@/components/comment/CommentThread";
import { getReactionState } from "@/app/actions/reactions";
import { isFollowing } from "@/app/actions/follows";
import { getCommentTree } from "@/lib/comments";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ username: string; slug: string }>;
}

// Adapts the cached PublicPost to the shape this page renders (Date objects,
// `user` key). The slug→author check lives inside getPublicPost.
async function getPost(username: string, slug: string) {
  const post = await getPublicPost(username, slug);
  if (!post) return null;
  return {
    ...post,
    publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
    createdAt: new Date(post.createdAt),
    user: post.author,
    tags: post.tags.map((tag) => ({ tag })),
  };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username, slug } = await params;
  const post = await getPost(username, slug);
  if (!post) return { title: "Post not found" };
  return {
    title: post.title,
    description: post.description ?? undefined,
  };
}

export default async function PostPage({ params }: PageProps) {
  const { username, slug } = await params;
  const post = await getPost(username, slug);
  if (!post) notFound();

  // Drafts are visible only to their author.
  const session = await getSession();
  const isAuthor = session?.user.id === post.userId;
  if (!post.published && !isAuthor) notFound();

  // Write-behind view count: a cheap Redis INCR, drained to Postgres every 5
  // min by flush-view-counts. Skip the author's own views and drafts.
  if (post.published && !isAuthor) {
    void incrementViews(post.id);
  }

  const published = post.publishedAt ?? post.createdAt;

  // Social state — only meaningful once the post is public.
  const [reactionState, followingAuthor, comments] = await Promise.all([
    getReactionState(post.id),
    session && !isAuthor
      ? isFollowing(post.userId, "USER")
      : Promise.resolve(false),
    getCommentTree(post.id, session?.user.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Card className="overflow-hidden">
        {post.coverImage && (
          // eslint-disable-next-line @next/next/no-img-element -- cover images are arbitrary external URLs (PRD stores URLs, not uploads)
          <img
            src={post.coverImage}
            alt=""
            className="max-h-96 w-full object-cover"
          />
        )}

        <div className="p-6 sm:p-10">
          {isAuthor && (
            <div className="mb-4 flex items-center gap-3">
              {!post.published && (
                <span className="rounded border border-warning px-2 py-1 text-s text-warning">
                  Draft — only you can see this
                </span>
              )}
              <Link
                href={`/edit/${post.id}`}
                className="text-s text-secondary underline hover:text-body"
              >
                Edit
              </Link>
            </div>
          )}

          <h1 className="text-3xl font-extrabold leading-tight text-body">
            {post.title}
          </h1>

          <div className="mt-4 flex items-center gap-3">
            <Avatar
              name={post.user.name}
              src={post.user.profileImage ?? post.user.image}
              size="l"
            />
            <div className="flex-1">
              <Link
                href={`/${post.user.username}`}
                className="font-medium text-body hover:text-brand"
              >
                {post.user.name}
              </Link>
              <p className="text-s text-secondary">
                <time dateTime={published.toISOString()}>
                  {published.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </time>
                {" · "}
                {post.readingTime} min read
              </p>
            </div>
            {!isAuthor && post.user.username && (
              <FollowButton
                followableId={post.userId}
                followableType="USER"
                initialFollowing={followingAuthor}
                signedIn={reactionState.signedIn}
              />
            )}
          </div>

          {post.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {post.tags.map(({ tag }) => (
                <Tag
                  key={tag.id}
                  name={tag.name}
                  color={tag.bgColorHex}
                  href={`/t/${tag.name}`}
                />
              ))}
            </div>
          )}

          {post.published && (
            <div className="mt-6 border-y border-border py-2">
              <ReactionBar
                postId={post.id}
                signedIn={reactionState.signedIn}
                initialCounts={reactionState.counts}
                initialMine={[...reactionState.mine]}
                orientation="horizontal"
              />
            </div>
          )}

          {post.processingState === "READY" && post.processedHtml ? (
            <div
              className="post-body mt-8"
              // Safe: processedHtml came from lib/markdown.ts, which runs rehypeSanitize.
              dangerouslySetInnerHTML={{ __html: post.processedHtml }}
            />
          ) : (
            <ProcessingState failed={post.processingState === "FAILED"} />
          )}

          {post.published && (
            <CommentThread
              comments={comments}
              postId={post.id}
              signedIn={reactionState.signedIn}
              total={post.commentsCount}
            />
          )}
        </div>
      </Card>
    </main>
  );
}
