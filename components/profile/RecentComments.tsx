import Link from "next/link";
import { Card } from "@/components/ui";
import type { RecentComment } from "@/lib/profile";

function relTime(date: Date): string {
  const d = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function RecentComments({ comments }: { comments: RecentComment[] }) {
  if (comments.length === 0) return null;

  return (
    <div>
      <h2 className="mb-3 text-l font-bold">Recent comments</h2>
      <ul className="flex flex-col gap-3">
        {comments.map((c) => {
          const href = `/${c.post.authorUsername}/${c.post.slug}`;
          return (
            <li key={c.id}>
              <Card hover className="p-4">
                <Link href={href} className="block">
                  <p className="text-s text-secondary">
                    On <span className="text-body">{c.post.title}</span> ·{" "}
                    {relTime(c.createdAt)}
                  </p>
                  <div
                    className="post-body mt-1 line-clamp-2 text-s"
                    // Safe: comment HTML came from lib/markdown.ts (rehypeSanitize).
                    dangerouslySetInnerHTML={{ __html: c.html }}
                  />
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
