import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const projects = process.env.PROJECTS_WEB_URL || "http://127.0.0.1:3002";
    return { beforeFiles: [
      { source: "/projects/:path*", destination: `${projects}/projects/:path*` },
    ] };
  },
};

export default nextConfig;
