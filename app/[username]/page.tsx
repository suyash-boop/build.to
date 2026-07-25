import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isFollowing } from "@/app/actions/follows";
import { profileLinks } from "@/lib/profile-links";
import { getProfileStats, getRecentComments } from "@/lib/profile";
import { Avatar, Card, EmptyState } from "@/components/ui";
import { PostCard } from "@/components/post/PostCard";
import { FollowButton } from "@/components/FollowButton";
import { RepoCard } from "@/components/RepoCard";
import { SidebarCard } from "@/components/profile/SidebarCard";
import { RecentComments } from "@/components/profile/RecentComments";
import {
  BriefcaseIcon,
  CalendarIcon,
  EmailIcon,
  GradIcon,
  LinkIcon,
  LocationIcon,
} from "@/components/profile/icons";
import type { GithubRepo } from "@/lib/github";

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

function MetaItem({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 text-secondary">
      {icon}
      {children}
    </span>
  );
}

export default async function ProfilePage({ params }: PageProps) {
  const { username } = await params;
  const user = await getProfile(username);
  if (!user) notFound();

  const session = await getSession();
  const isOwnProfile = session?.user.id === user.id;

  const [following, feed, stats, recentComments] = await Promise.all([
    session && !isOwnProfile
      ? isFollowing(user.id, "USER")
      : Promise.resolve(false),
    getPostsForUser(user.id),
    getProfileStats(user.id),
    getRecentComments(user.id),
  ]);

  const links = profileLinks(user);
  const showcasedRepos: GithubRepo[] = Array.isArray(user.showcasedRepos)
    ? (user.showcasedRepos as unknown as GithubRepo[])
    : [];
  const joined = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const enrichment = [
    { title: "Skills / languages", value: user.skills },
    { title: "Currently learning", value: user.currentlyLearning },
    { title: "Currently hacking on", value: user.currentlyHackingOn },
    { title: "Available for", value: user.availableFor },
  ].filter((f) => f.value);

  return (
    <main className="mx-auto max-w-4xl px-4 pb-10">
      {/* Brand-colour banner (PRD §5.5) */}
      <div
        className="h-28 rounded-b-large sm:h-36"
        style={{ backgroundColor: user.brandColor }}
      />

      {/* Centered header card */}
      <Card className="-mt-12 px-6 pb-6 text-center">
        <div className="flex justify-center">
          <span className="-mt-14 block size-24 overflow-hidden rounded-full border-4 border-body-bg">
            <Avatar
              name={user.name}
              src={user.profileImage ?? user.image}
              size="xl"
              className="size-full"
            />
          </span>
        </div>

        <div className="mt-2 flex justify-center">
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
              size="m"
            />
          )}
        </div>

        <h1 className="mt-3 text-2xl font-bold text-body">{user.name}</h1>
        <p className="text-secondary">@{user.username}</p>

        {user.bio && (
          <p className="mx-auto mt-2 max-w-xl text-body">{user.bio}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-s">
          {user.pronouns && (
            <span className="text-secondary">{user.pronouns}</span>
          )}
          {user.location && (
            <MetaItem icon={<LocationIcon />}>{user.location}</MetaItem>
          )}
          <MetaItem icon={<CalendarIcon />}>Joined {joined}</MetaItem>
          {user.displayEmailOnProfile && (
            <MetaItem icon={<EmailIcon />}>
              <a href={`mailto:${user.email}`} className="hover:text-brand">
                {user.email}
              </a>
            </MetaItem>
          )}
          {user.work && (
            <MetaItem icon={<BriefcaseIcon />}>{user.work}</MetaItem>
          )}
          {user.education && (
            <MetaItem icon={<GradIcon />}>{user.education}</MetaItem>
          )}
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex items-center gap-1.5 text-brand hover:underline"
            >
              <LinkIcon />
              {link.label}
            </a>
          ))}
        </div>
      </Card>

      {/* Two-column body: sidebar + main */}
      <div className="mt-6 grid gap-6 md:grid-cols-[240px_1fr]">
        <aside className="flex flex-col gap-4">
          {enrichment.map((f) => (
            <SidebarCard key={f.title} title={f.title}>
              {f.value}
            </SidebarCard>
          ))}

          <Card className="p-4">
            <div className="flex flex-col gap-2 text-s text-secondary">
              <span>
                <span className="font-semibold text-body">
                  {stats.postsCount}
                </span>{" "}
                {stats.postsCount === 1 ? "post" : "posts"} published
              </span>
              <span>
                <span className="font-semibold text-body">
                  {stats.commentsCount}
                </span>{" "}
                {stats.commentsCount === 1 ? "comment" : "comments"} written
              </span>
              <span>
                <span className="font-semibold text-body">
                  {stats.tagsFollowedCount}
                </span>{" "}
                {stats.tagsFollowedCount === 1 ? "tag" : "tags"} followed
              </span>
            </div>
          </Card>
        </aside>

        <div className="flex min-w-0 flex-col gap-8">
          {showcasedRepos.length > 0 && (
            <section>
              <h2 className="mb-3 text-l font-bold">Projects</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {showcasedRepos.map((repo) => (
                  <RepoCard key={repo.id} repo={repo} />
                ))}
              </div>
            </section>
          )}

          <section>
            {feed.length === 0 ? (
              <EmptyState
                title={
                  isOwnProfile ? "You haven't published yet" : "No posts yet"
                }
                description={isOwnProfile ? "Write your first post." : undefined}
              />
            ) : (
              <>
                <h2 className="mb-3 text-l font-bold">Posts</h2>
                <ul className="flex flex-col gap-4">
                  {feed.map((post) => (
                    <li key={post.id}>
                      <PostCard post={post} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <RecentComments comments={recentComments} />
        </div>
      </div>
    </main>
  );
}

// A user's published posts, newest first (uses the shared card select).
async function getPostsForUser(userId: string) {
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
