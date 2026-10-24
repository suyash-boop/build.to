import type { Paginated, ProjectCard } from "@bldt/contracts";
import type { MetadataRoute } from "next";

const SITE = `${(process.env.WEB_ORIGIN || "http://localhost:3000").replace(/\/$/, "")}/projects`;
const API = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";
const MAX_PAGES = 20;

// Rendered per request: the origin and the project list come from the running deployment, not the build.
export const dynamic = "force-dynamic";

/** Public projects and their owners only. Unlisted and private projects are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/discover`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  const owners = new Set<string>();
  let cursor: string | null = null;
  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const res = await fetch(`${API}/discover/projects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) break;
      const page = (await res.json()) as Paginated<ProjectCard>;
      for (const p of page.items) {
        entries.push({ url: `${SITE}/${p.owner.username}/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly", priority: 0.6 });
        owners.add(p.owner.username);
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  } catch {
    // API unreachable at build or request time: serve the static entries rather than failing.
  }
  for (const u of owners) entries.push({ url: `${SITE}/${u}`, changeFrequency: "weekly", priority: 0.5 });
  return entries;
}
