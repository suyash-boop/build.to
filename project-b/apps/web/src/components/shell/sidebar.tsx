"use client";

import type { Me, SidebarProject } from "@bldt/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Compass, Home, Inbox, LogOut, Menu as MenuIcon, Monitor, Moon, Plus, Search, Settings, Sun, User, X } from "lucide-react";
import { m } from "motion/react";
import { IntentLink } from "@/components/ui/intent-link";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StageGlyph } from "@/components/domain/status";
import { Wordmark } from "@/components/domain/logo";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/misc";
import { ModKey } from "@/components/ui/mod-key";
import { http } from "@/lib/api.client";
import { useHotkeys } from "@/lib/hotkeys";
import { readTheme, setTheme, type ThemePref } from "@/lib/theme";
import { indicatorSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { usePalette } from "./command-palette";

export function Sidebar({ me, projects: initialProjects }: { me: Me; projects: SidebarProject[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const palette = usePalette();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Below md the sidebar is an off-canvas drawer: when closed it must leave the tab order
  // and the accessibility tree, not just slide out of view.
  const [isMobile, setIsMobile] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767.98px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMobileOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);
  const hidden = isMobile && !mobileOpen;

  const { data: projects = initialProjects } = useQuery({
    queryKey: ["me", "projects"],
    queryFn: () => http.get<{ items: SidebarProject[] }>("/me/projects").then((r) => r.items),
    initialData: initialProjects,
  });
  const { data: unread = me.unreadNotifications } = useQuery({
    queryKey: ["me", "unread"],
    queryFn: () => http.get<Me>("/me").then((m) => m.unreadNotifications),
    initialData: me.unreadNotifications,
    refetchInterval: 60_000,
  });

  useEffect(() => setMobileOpen(false), [pathname]);

  useHotkeys({
    "g h": () => router.push("/home"),
    "g i": () => router.push("/inbox"),
    "g d": () => router.push("/discover"),
    "g p": () => router.push(`/${me.username}`),
    "g s": () => router.push("/settings"),
  });

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between px-3">
        <Link href="/home" className="rounded-md px-1 py-0.5 text-sm font-semibold tracking-tight">
          Your workspace
        </Link>
        <button ref={closeButton} className="rounded-md p-1 text-muted hover:bg-surface-hover md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X className="size-4" />
        </button>
      </div>

      <div className="px-2">
        <button
          onClick={() => palette?.open()}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-faint hover:border-border-strong hover:text-muted"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search</span>
          <ModKey k="K" />
        </button>
      </div>

      <div className="mt-3 space-y-px px-2">
        <NavLink href="/home" icon={<Home className="size-4" />} active={pathname === "/home"}>
          Overview
        </NavLink>
        <NavLink href="/inbox" icon={<Inbox className="size-4" />} active={pathname === "/inbox"} badge={unread > 0 ? unread : undefined}>
          Inbox
        </NavLink>
        <NavLink href="/discover" icon={<Compass className="size-4" />} active={pathname.startsWith("/discover")}>
          Discover
        </NavLink>
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="flex h-7 items-center justify-between px-4">
          <span className="text-2xs font-medium uppercase tracking-wide text-faint">Projects</span>
          <Link href="/new" className="rounded p-0.5 text-faint hover:bg-surface-hover hover:text-fg" aria-label="New project" title="New project">
            <Plus className="size-3.5" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-2">
          {projects.length === 0 ? (
            <Link href="/new" className="mx-1 mt-1 block rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted hover:border-border-strong hover:text-fg">
              Import a repository or start a project
            </Link>
          ) : (
            projects.map((p) => {
              const href = `/${p.ownerUsername}/${p.slug}`;
              return (
                <NavLink key={p.id} href={href} icon={<StageGlyph stage={p.stage} size={9} />} active={pathname === href || pathname.startsWith(href + "/")}>
                  {p.name}
                </NavLink>
              );
            })
          )}
        </div>
      </div>

      <div className="border-t border-border p-2">
        <UserMenu me={me} />
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-bg/95 px-3 backdrop-blur md:hidden">
        <button ref={menuButton} onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-surface-hover" aria-label="Open menu" aria-expanded={mobileOpen}>
          <MenuIcon className="size-4" />
        </button>
        <Link href="/home">
          <Wordmark />
        </Link>
        <button onClick={() => palette?.open()} className="rounded-md p-1.5 text-muted hover:bg-surface-hover" aria-label="Search">
          <Search className="size-4" />
        </button>
      </div>

      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside
        inert={hidden}
        aria-hidden={hidden || undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-60 border-r border-border bg-surface transition-transform duration-150 md:sticky md:top-16 md:z-auto md:h-[calc(100dvh-4rem)] md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {nav}
      </aside>
    </>
  );
}

function NavLink({ href, icon, active, badge, children }: { href: string; icon: ReactNode; active: boolean; badge?: number; children: ReactNode }) {
  return (
    <IntentLink
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "transition-ui group relative flex h-7 items-center gap-2.5 rounded-md px-2 text-sm",
        active ? "font-medium text-fg" : "text-muted hover:bg-surface-hover/60 hover:text-fg",
      )}
    >
      {/* Highlight and accent bar glide to the new item instead of jumping. */}
      {active && (
        <>
          <m.span layoutId="nav-active-bg" transition={indicatorSpring} className="absolute inset-0 -z-0 rounded-md bg-surface-hover" aria-hidden />
          <m.span layoutId="nav-active-bar" transition={indicatorSpring} className="absolute -left-2 top-1.5 h-4 w-0.5 rounded-r bg-fg" aria-hidden />
        </>
      )}
      <span className="relative flex w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="relative min-w-0 flex-1 truncate">{children}</span>
      {badge !== undefined && (
        <span className="relative rounded-sm bg-accent-soft px-1.5 text-2xs font-medium text-accent tnum">{badge > 99 ? "99+" : badge}</span>
      )}
    </IntentLink>
  );
}

function UserMenu({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [theme, setThemeState] = useState<ThemePref>("system");
  useEffect(() => setThemeState(readTheme()), []);

  const chooseTheme = (t: ThemePref) => {
    setTheme(t);
    setThemeState(t);
  };

  const signOut = async () => {
    const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!response.ok) return;
    qc.clear();
    window.location.assign("/");
  };

  return (
    <Menu>
      <MenuTrigger className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover">
        <Avatar user={me} size={22} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-4">{me.displayName}</span>
          <span className="block truncate text-2xs leading-4 text-faint">@{me.username}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-faint" />
      </MenuTrigger>
      <MenuContent align="start" side="top" className="w-56">
        <MenuItem onSelect={() => window.location.assign(`/${me.username}`)}>
          <User className="size-4 text-muted" /> Your profile
        </MenuItem>
        <MenuItem onSelect={() => router.push("/settings")}>
          <Settings className="size-4 text-muted" /> Workspace settings
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        {(
          [
            ["system", "System", <Monitor key="m" className="size-4 text-muted" />],
            ["light", "Light", <Sun key="s" className="size-4 text-muted" />],
            ["dark", "Dark", <Moon key="d" className="size-4 text-muted" />],
          ] as const
        ).map(([value, label, icon]) => (
          <MenuItem key={value} onSelect={(e) => { e.preventDefault(); chooseTheme(value); }}>
            {icon}
            <span className="flex-1">{label}</span>
            {theme === value && <Check className="size-3.5 text-fg" />}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={signOut}>
          <LogOut className="size-4 text-muted" /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
