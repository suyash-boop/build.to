import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { Avatar, Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MarkReadOnView } from "./MarkReadOnView";

export const metadata = { title: "Notifications" };

const verb = {
  NEW_REACTION: "reacted to your post",
  NEW_COMMENT: "commented on your post",
  NEW_FOLLOWER: "followed you",
} as const;

const typeIcon = {
  NEW_REACTION: "❤️",
  NEW_COMMENT: "💬",
  NEW_FOLLOWER: "👤",
} as const;

function relativeTime(date: Date): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.username) redirect("/onboarding");

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      actor: { select: { name: true, username: true, profileImage: true, image: true } },
    },
  });

  // Resolve the post slugs referenced by post-related notifications in one query.
  const postIds = [
    ...new Set(notifications.map((n) => n.postId).filter((id): id is string => !!id)),
  ];
  const posts = postIds.length
    ? await prisma.post.findMany({
        where: { id: { in: postIds } },
        select: { id: true, slug: true, title: true, user: { select: { username: true } } },
      })
    : [];
  const postById = new Map(posts.map((p) => [p.id, p]));

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <MarkReadOnView />
      <h1 className="mb-4 text-xl font-bold">Notifications</h1>

      {notifications.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="Reactions, comments, and new followers show up here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((n) => {
            const post = n.postId ? postById.get(n.postId) : null;
            const href = post
              ? `/${post.user.username}/${post.slug}`
              : `/${n.actor.username}`;
            return (
              <li key={n.id}>
                <Card
                  hover
                  className={cn(
                    "p-3 transition-colors",
                    !n.read && "bg-brand/4",
                  )}
                >
                  <Link href={href} className="flex items-start gap-3">
                    <div className="relative shrink-0">
                      <Avatar
                        name={n.actor.name}
                        src={n.actor.profileImage ?? n.actor.image}
                        size="l"
                      />
                      <span
                        aria-hidden
                        className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-border bg-body-bg text-[10px]"
                      >
                        {typeIcon[n.type]}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-base leading-snug">
                        <span className="font-semibold text-body">
                          {n.actor.name}
                        </span>{" "}
                        <span className="text-secondary">{verb[n.type]}</span>
                        {post && (
                          <span className="font-medium text-body">
                            {" "}
                            {post.title}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-s text-secondary">
                        {relativeTime(n.createdAt)}
                      </p>
                    </div>

                    {!n.read && (
                      <span
                        aria-label="Unread"
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-brand"
                      />
                    )}
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
