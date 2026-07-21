import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { Avatar, Card, EmptyState } from "@/components/ui";
import { MarkReadOnView } from "./MarkReadOnView";

export const metadata = { title: "Notifications" };

const verb = {
  NEW_REACTION: "reacted to your post",
  NEW_COMMENT: "commented on your post",
  NEW_FOLLOWER: "followed you",
} as const;

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
                <Card hover className={n.read ? "p-3" : "border-brand p-3"}>
                  <Link href={href} className="flex items-center gap-3">
                    <Avatar
                      name={n.actor.name}
                      src={n.actor.profileImage ?? n.actor.image}
                      size="m"
                    />
                    <p className="text-base">
                      <span className="font-medium text-body">
                        {n.actor.name}
                      </span>{" "}
                      <span className="text-secondary">{verb[n.type]}</span>
                      {post && (
                        <span className="text-body"> {post.title}</span>
                      )}
                    </p>
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
