import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const config: NextConfig = {
  basePath: "/projects",
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle for the container image; trace from the monorepo root.
  // Vercel packages the app itself and needs the regular output.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../.."),
  turbopack: { root: path.join(import.meta.dirname, "../../..") },
  // Dev-only overlay; compile and runtime errors still surface.
  devIndicators: false,
  transpilePackages: ["@bldt/contracts"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },
  // The browser talks to one origin; /api is proxied to the API by src/app/api/[...path]/route.ts.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
