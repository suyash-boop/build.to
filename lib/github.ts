import { redis } from "@/lib/redis";

/**
 * A public GitHub repository, trimmed to what the profile showcase needs. This
 * is also the shape stored in User.showcasedRepos (snapshotted at selection).
 */
export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  language: string | null;
  updatedAt: string;
}

const CACHE_TTL_SECONDS = 600; // 10 min — GitHub's unauthenticated limit is 60/hr/IP
const USERNAME_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

interface FetchResult {
  ok: true;
  repos: GithubRepo[];
}
interface FetchError {
  ok: false;
  error: string;
}

/**
 * Fetch a user's PUBLIC repositories, most-starred first. Cached in Valkey so a
 * settings page reload doesn't spend the small unauthenticated rate budget. No
 * token is used, so only public data is ever visible.
 */
export async function fetchPublicRepos(
  username: string,
): Promise<FetchResult | FetchError> {
  const handle = username.trim();
  if (!USERNAME_PATTERN.test(handle)) {
    return { ok: false, error: "That doesn't look like a GitHub username." };
  }

  const cacheKey = `github:repos:${handle.toLowerCase()}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return { ok: true, repos: JSON.parse(cached) as GithubRepo[] };
    }
  } catch {
    // Cache miss on a Redis hiccup is fine — fall through to the API.
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(
        handle,
      )}/repos?per_page=100&sort=updated&type=owner`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "build.to",
        },
        // Next.js fetch cache is bypassed; we manage caching in Valkey.
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, error: "Could not reach GitHub. Try again." };
  }

  if (res.status === 404) {
    return { ok: false, error: `No GitHub user named "${handle}".` };
  }
  if (res.status === 403) {
    return { ok: false, error: "GitHub rate limit hit. Try again in a bit." };
  }
  if (!res.ok) {
    return { ok: false, error: "GitHub returned an error." };
  }

  // The GitHub REST repo objects — only the fields we keep are typed.
  const raw = (await res.json()) as Array<{
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    updated_at: string;
    fork: boolean;
    private: boolean;
    archived: boolean;
  }>;

  const repos: GithubRepo[] = raw
    // Defensive: the endpoint is public-only, but never surface a private/fork.
    .filter((r) => !r.private && !r.fork && !r.archived)
    .map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      url: r.html_url,
      stars: r.stargazers_count,
      forks: r.forks_count,
      language: r.language,
      updatedAt: r.updated_at,
    }))
    .sort((a, b) => b.stars - a.stars || (a.name < b.name ? -1 : 1));

  try {
    await redis.set(cacheKey, JSON.stringify(repos), "EX", CACHE_TTL_SECONDS);
  } catch {
    // Non-fatal if the cache write fails.
  }

  return { ok: true, repos };
}
