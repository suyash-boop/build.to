import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import { PlatformHeader } from "@/components/shell/platform-header";

// Geist: geometric like the logo letterforms, built for interfaces.

const SITE = process.env.WEB_ORIGIN || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Projects · build.to", template: "%s · build.to Projects" },
  description: "A workspace for building software with other people, connected to GitHub, where shipped work becomes your record.",
  applicationName: "bld.t",
  openGraph: { siteName: "bld.t", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  const dataTheme = theme === "light" || theme === "dark" ? theme : undefined;
  return (
    <html lang="en" data-theme={dataTheme ?? "light"} suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers><PlatformHeader />{children}</Providers>
      </body>
    </html>
  );
}
