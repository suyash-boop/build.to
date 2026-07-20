import Link from "next/link";
import { Avatar, Card, Tag } from "@/components/ui";

export interface PostCardData {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  readingTime: number;
  reactionsCount: number;
  commentsCount: number;
  publishedAt: Date | null;
  createdAt?: Date;
  author: {
    name: string;
    username: string | null;
    image: string | null;
  };
  tags?: { name: string; bgColorHex: string }[];
}

/** Feed post card (PRD §5.4) — cover, author, title, tags, counts, reading time. */
export function PostCard({ post }: { post: PostCardData }) {
  const href = `/${post.author.username}/${post.slug}`;
  const date = post.publishedAt ?? post.createdAt ?? null;

  return (
    <Card hover className="overflow-hidden">
      {post.coverImage && (
        <Link href={href} aria-hidden tabIndex={-1}>
          {/* eslint-disable-next-line @next/next/no-img-element -- cover images are arbitrary external URLs */}
          <img
            src={post.coverImage}
            alt=""
            className="max-h-64 w-full object-cover"
          />
        </Link>
      )}

      <div className="p-5">
        <div className="flex items-center gap-2">
          <Avatar name={post.author.name} src={post.author.image} size="m" />
          <div className="text-s leading-tight">
            <Link
              href={`/${post.author.username}`}
              className="font-medium text-body hover:text-brand"
            >
              {post.author.name}
            </Link>
            {date && (
              <p className="text-secondary">
                <time dateTime={date.toISOString()}>
                  {date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year:
                      date.getFullYear() === new Date().getFullYear()
                        ? undefined
                        : "numeric",
                  })}
                </time>
              </p>
            )}
          </div>
        </div>

        <h2 className="mt-2 text-xl font-bold leading-tight">
          <Link href={href} className="text-body hover:text-brand">
            {post.title}
          </Link>
        </h2>

        {post.tags && post.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {post.tags.map((tag) => (
              <Tag
                key={tag.name}
                name={tag.name}
                color={tag.bgColorHex}
                href={`/t/${tag.name}`}
              />
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-4 text-s text-secondary">
          <span>
            {post.reactionsCount}{" "}
            {post.reactionsCount === 1 ? "reaction" : "reactions"}
          </span>
          <span>
            {post.commentsCount}{" "}
            {post.commentsCount === 1 ? "comment" : "comments"}
          </span>
          <span className="ml-auto">{post.readingTime} min read</span>
        </div>
      </div>
    </Card>
  );
}
