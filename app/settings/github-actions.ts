"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { fetchPublicRepos, type GithubRepo } from "@/lib/github";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

const MAX_SHOWCASED = 6;

export type ReposResult =
  | { ok: true; repos: GithubRepo[] }
  | { ok: false; error: string };

/** Fetch the current user's public repos for the selection UI. */
export async function loadReposForShowcase(): Promise<ReposResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { githubUsername: true },
  });
  if (!user?.githubUsername) {
    return {
      ok: false,
      error: "Add your GitHub username in the Social links section first.",
    };
  }

  return fetchPublicRepos(user.githubUsername);
}

export type SaveShowcaseResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * Save the selected repos to showcase. Receives the chosen repo ids; the repo
 * data is re-fetched (cached) and snapshotted so the profile doesn't depend on
 * a live GitHub call to render.
 */
export async function saveShowcase(
  selectedIds: number[],
): Promise<SaveShowcaseResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };
  if (selectedIds.length > MAX_SHOWCASED) {
    return { ok: false, error: `Choose up to ${MAX_SHOWCASED} projects.` };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { githubUsername: true, username: true },
  });
  if (!user?.githubUsername) {
    return { ok: false, error: "No GitHub username on file." };
  }

  const result = await fetchPublicRepos(user.githubUsername);
  if (!result.ok) return result;

  const chosen = new Set(selectedIds);
  // Preserve the order the user's repos are listed in (by stars).
  const showcased = result.repos.filter((r) => chosen.has(r.id));

  await prisma.user.update({
    where: { id: session.user.id },
    // Cast through the Prisma JSON input type — a typed array isn't inferred as
    // InputJsonValue automatically.
    data: {
      showcasedRepos: showcased as unknown as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/settings");
  if (user.username) revalidatePath(`/${user.username}`);

  return { ok: true, count: showcased.length };
}
