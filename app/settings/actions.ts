"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { revalidatePath } from "next/cache";

export type SettingsState =
  | { ok: true }
  | { ok: false; error: string }
  | null;

// Length caps mirror the profile UI counters (bio 200, the long-text fields
// ≤200, single-line fields ≤100).
const LIMITS = {
  name: 100,
  bio: 200,
  location: 100,
  websiteUrl: 200,
  work: 100,
  education: 100,
  pronouns: 100,
  skills: 200,
  currentlyLearning: 200,
  availableFor: 200,
  currentlyHackingOn: 200,
  profileImage: 500,
  profileBgImage: 500,
  githubUsername: 100,
  twitterUsername: 100,
  mastodonUsername: 200,
  facebookUsername: 100,
  instagramUsername: 100,
  youtubeUrl: 200,
  twitchUsername: 100,
} as const;

type FieldKey = keyof typeof LIMITS;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function trimmedOrNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const data: Record<string, string | null | boolean> = {};

  for (const key of Object.keys(LIMITS) as FieldKey[]) {
    const value = trimmedOrNull(formData.get(key));
    if (value && value.length > LIMITS[key]) {
      return {
        ok: false,
        error: `${key} is too long (max ${LIMITS[key]} characters).`,
      };
    }
    data[key] = value;
  }

  // name is required — fall back to the existing value rather than clearing it.
  if (!data.name) {
    return { ok: false, error: "Display name is required." };
  }

  const brandColor = String(formData.get("brandColor") ?? "").trim();
  if (brandColor && !HEX_COLOR.test(brandColor)) {
    return { ok: false, error: "Brand colour must be a hex value like #4f46e5." };
  }
  data.brandColor = brandColor || "#000000";

  data.displayEmailOnProfile = formData.get("displayEmailOnProfile") === "on";

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  revalidatePath("/settings");
  if (session.user.username) {
    revalidatePath(`/${session.user.username}`);
  }
  return { ok: true };
}
