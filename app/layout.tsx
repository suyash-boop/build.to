import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { getTheme } from "@/lib/theme";

export const metadata: Metadata = {
  title: "build.to",
  description: "A place to write and read technical posts.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the theme on the server so <html data-theme> is correct on first
  // paint — no flash of the wrong theme (PRD §8.3).
  const theme = await getTheme();

  return (
    <html lang="en" className="h-full" data-theme={theme}>
      <body className="min-h-full antialiased">
        <Header />
        {children}
      </body>
    </html>
  );
}
