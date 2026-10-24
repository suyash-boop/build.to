import type { SidebarProject } from "@bldt/contracts";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { CommandPaletteProvider } from "@/components/shell/command-palette";
import { PublicHeader, SiteFooter } from "@/components/shell/public-header";
import { HuddleWatcher } from "@/components/shell/huddle-watcher";
import { RealtimeBridge } from "@/components/shell/realtime";
import { Sidebar } from "@/components/shell/sidebar";
import { api, getMe } from "@/lib/api.server";

/**
 * One shell for every page except the landing and legal pages. Signed-in users get the
 * workspace sidebar; visitors viewing a public profile or project get a light public header.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  // Independent requests: fetch together rather than one after the other.
  const [me, projects] = await Promise.all([
    getMe(),
    (await cookies()).getAll().some((c) => c.name.includes("better-auth."))
      ? api<{ items: SidebarProject[] }>("/me/projects").then((r) => r.items).catch(() => [] as SidebarProject[])
      : Promise.resolve([] as SidebarProject[]),
  ]);

  return (
    <CommandPaletteProvider signedIn={Boolean(me)} username={me?.username} projects={projects}>
      {me ? (
        <div className="md:flex">
          <RealtimeBridge />
          <HuddleWatcher viewerId={me.id} />
          <Sidebar me={me} projects={projects} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      ) : (
        <div className="public-shell flex min-h-dvh flex-col">
          <PublicHeader />
          <main className="min-w-0 flex-1">{children}</main>
          <SiteFooter />
        </div>
      )}
    </CommandPaletteProvider>
  );
}
