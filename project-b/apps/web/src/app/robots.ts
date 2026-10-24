import type { MetadataRoute } from "next";

const SITE = process.env.WEB_ORIGIN || "http://localhost:3000";

// Read the origin at request time; a build-time render would bake in whatever the build machine had.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/projects/",
        // Workspace and account pages are per-user; nothing useful to index.
        disallow: ["/projects/api/", "/projects/home", "/projects/inbox", "/projects/new", "/projects/settings", "/projects/login", "/projects/*/tasks", "/projects/*/settings"],
      },
    ],
    sitemap: `${SITE}/projects/sitemap.xml`,
  };
}
