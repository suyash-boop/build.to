/* eslint-disable @next/next/no-html-link-for-pages -- /projects is a separate Next.js zone and needs hard navigation. */
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { SettingsForm } from "./SettingsForm";
import { GithubShowcase } from "./GithubShowcase";
import type { GithubRepo } from "@/lib/github";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.username) redirect("/onboarding");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) redirect("/login");

  // Pass the fields the form edits (everything except auth-managed columns).
  const values = {
    name: user.name,
    profileImage: user.profileImage,
    displayEmailOnProfile: user.displayEmailOnProfile,
    bio: user.bio,
    location: user.location,
    websiteUrl: user.websiteUrl,
    profileBgImage: user.profileBgImage,
    skills: user.skills,
    currentlyLearning: user.currentlyLearning,
    availableFor: user.availableFor,
    currentlyHackingOn: user.currentlyHackingOn,
    pronouns: user.pronouns,
    work: user.work,
    education: user.education,
    githubUsername: user.githubUsername,
    twitterUsername: user.twitterUsername,
    mastodonUsername: user.mastodonUsername,
    instagramUsername: user.instagramUsername,
    facebookUsername: user.facebookUsername,
    twitchUsername: user.twitchUsername,
    youtubeUrl: user.youtubeUrl,
    brandColor: user.brandColor,
  };

  const showcasedIds = Array.isArray(user.showcasedRepos)
    ? (user.showcasedRepos as unknown as GithubRepo[]).map((r) => r.id)
    : [];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      <h1 className="text-xl font-bold">Settings</h1>
      <a href="/projects/settings" className="rounded-large border border-border bg-body-bg p-4 text-s text-secondary transition-colors hover:border-brand"><span className="font-semibold text-brand">Project workspace settings ↗</span><span className="mt-1 block">Your profile is shared. Manage repository connections, editor access, and build history in the workspace.</span></a>
      <SettingsForm values={values} />
      <GithubShowcase
        hasGithubUsername={!!user.githubUsername}
        initialSelectedIds={showcasedIds}
      />
    </main>
  );
}
