import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isFollowing } from "@/app/actions/follows";
import { profileLinks } from "@/lib/profile-links";
import { Avatar, Card, EmptyState } from "@/components/ui";
import { PostCard } from "@/components/post/PostCard";
import { FollowButton } from "@/components/FollowButton";

interface PageProps {
  params: Promise<{ username: string }>;
}

async function getProfile(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params;
  const user = await getProfile(username);
  if (!user) return { title: "Profile not found" };
  return {
    title: `${user.name} (@${user.username})`,
    description: user.bio ?? undefined,
  };
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-secondary">
      <span className="sr-only">{label}: </span>
      {value}
    </span>
  );
}

export default async function ProfilePage({ params }: PageProps) {
  const { username } = await params;
  const user = await getProfile(username);
  if (!user) notFound();

  const session = await getSession();
  const isOwnProfile = session?.user.id === user.id;

  const [following, feed] = await Promise.all([
    session && !isOwnProfile
      ? isFollowing(user.id, "USER")
      : Promise.resolve(false),
    getLatestFeedForUser(user.id),
  ]);

  const links = profileLinks(user);
  const joined = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <main className="mx-auto max-w-3xl px-4 pb-10">
      {/* Brand-colour banner (PRD §5.5) */}
      <div
        className="h-28 rounded-b-large sm:h-32"
        style={{ backgroundColor: user.brandColor }}
      />

      <Card className="-mt-12 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Avatar
            name={user.name}
            src={user.profileImage ?? user.image}
            size="xl"
            className="-mt-16 border-4 border-body-bg"
          />
          <div className="ml-auto">
            {isOwnProfile ? (
              <Link
                href="/settings"
                className="inline-flex h-8 items-center justify-center rounded border border-border px-3 text-s font-medium text-body transition-colors hover:bg-base-bg"
              >
                Edit profile
              </Link>
            ) : (
              <FollowButton
                followableId={user.id}
                followableType="USER"
                initialFollowing={following}
                signedIn={session !== null}
              />
            )}
          </div>
        </div>

        <h1 className="mt-3 text-2xl font-bold text-body">{user.name}</h1>
        <p className="text-secondary">@{user.username}</p>

        {user.bio && <p className="mt-3 text-body">{user.bio}</p>}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-s">
          {user.pronouns && <MetaItem label="Pronouns" value={user.pronouns} />}
          {user.location && <MetaItem label="Location" value={user.location} />}
          <MetaItem label="Joined" value={`Joined ${joined}`} />
          {user.work && <MetaItem label="Work" value={user.work} />}
          {user.education && (
            <MetaItem label="Education" value={user.education} />
          )}
        </div>

        {links.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-s">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-brand hover:underline"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}

        {(user.skills ||
          user.currentlyLearning ||
          user.availableFor ||
          user.currentlyHackingOn) && (
          <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-s sm:grid-cols-2">
            {user.skills && (
              <ProfileField label="Skills / languages" value={user.skills} />
            )}
            {user.currentlyLearning && (
              <ProfileField
                label="Currently learning"
                value={user.currentlyLearning}
              />
            )}
            {user.availableFor && (
              <ProfileField label="Available for" value={user.availableFor} />
            )}
            {user.currentlyHackingOn && (
              <ProfileField
                label="Currently hacking on"
                value={user.currentlyHackingOn}
              />
            )}
          </dl>
        )}

        <div className="mt-4 flex gap-4 border-t border-border pt-4 text-s text-secondary">
          <span>
            <span className="font-semibold text-body">{user.postsCount}</span>{" "}
            {user.postsCount === 1 ? "post" : "posts"}
          </span>
        </div>
      </Card>

      <section className="mt-6">
        {feed.length === 0 ? (
          <EmptyState
            title={
              isOwnProfile ? "You haven't published yet" : "No posts yet"
            }
            description={
              isOwnProfile ? "Write your first post." : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {feed.map((post) => (
              <li key={post.id}>
                <PostCard post={post} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-body">{label}</dt>
      <dd className="text-secondary">{value}</dd>
    </div>
  );
}

// A user's published posts, newest first (uses the shared card select).
async function getLatestFeedForUser(userId: string) {
  const posts = await prisma.post.findMany({
    where: { userId, published: true },
    orderBy: { publishedAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      coverImage: true,
      readingTime: true,
      reactionsCount: true,
      commentsCount: true,
      publishedAt: true,
      createdAt: true,
      user: {
        select: { name: true, username: true, profileImage: true, image: true },
      },
      tags: { select: { tag: { select: { name: true, bgColorHex: true } } } },
    },
  });

  return posts.map((post) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    description: post.description,
    coverImage: post.coverImage,
    readingTime: post.readingTime,
    reactionsCount: post.reactionsCount,
    commentsCount: post.commentsCount,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    author: {
      name: post.user.name,
      username: post.user.username,
      image: post.user.profileImage ?? post.user.image,
    },
    tags: post.tags.map((pt) => pt.tag),
  }));
}
