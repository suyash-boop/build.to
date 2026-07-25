import type { User } from "@prisma/client";

export interface ProfileLink {
  label: string;
  href: string;
}

/**
 * Build the outbound social links for a profile from the User's stored handles.
 * Usernames are turned into full URLs; websiteUrl and youtubeUrl are used as-is.
 * Only non-empty fields produce a link.
 */
export function profileLinks(user: User): ProfileLink[] {
  const links: ProfileLink[] = [];

  if (user.websiteUrl) {
    links.push({ label: "Website", href: normalizeUrl(user.websiteUrl) });
  }
  if (user.githubUsername) {
    links.push({
      label: "GitHub",
      href: `https://github.com/${user.githubUsername}`,
    });
  }
  if (user.twitterUsername) {
    links.push({
      label: "Twitter",
      href: `https://twitter.com/${user.twitterUsername}`,
    });
  }
  if (user.mastodonUsername) {
    links.push({
      label: "Mastodon",
      href: mastodonUrl(user.mastodonUsername),
    });
  }
  if (user.instagramUsername) {
    links.push({
      label: "Instagram",
      href: `https://instagram.com/${user.instagramUsername}`,
    });
  }
  if (user.facebookUsername) {
    links.push({
      label: "Facebook",
      href: `https://facebook.com/${user.facebookUsername}`,
    });
  }
  if (user.twitchUsername) {
    links.push({
      label: "Twitch",
      href: `https://twitch.tv/${user.twitchUsername}`,
    });
  }
  if (user.youtubeUrl) {
    links.push({ label: "YouTube", href: normalizeUrl(user.youtubeUrl) });
  }

  return links;
}

function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Mastodon handles look like @user@instance.social; turn that into a URL.
function mastodonUrl(handle: string): string {
  const cleaned = handle.replace(/^@/, "");
  const parts = cleaned.split("@");
  if (parts.length === 2) return `https://${parts[1]}/@${parts[0]}`;
  return normalizeUrl(cleaned);
}
