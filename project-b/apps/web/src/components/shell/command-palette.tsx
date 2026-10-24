"use client";

import { CategoryIcon } from "@/components/domain/discussion";
import type { SearchResults, SidebarProject } from "@bldt/contracts";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { ArrowRight, Compass, FolderPlus, Home, Inbox, Moon, Search, Settings, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { StageGlyph, StatusIcon } from "@/components/domain/status";
import { Avatar, Kbd } from "@/components/ui/misc";
import { http } from "@/lib/api.client";
import { useHotkeys } from "@/lib/hotkeys";
import { readTheme, setTheme } from "@/lib/theme";

interface PaletteApi {
  open: () => void;
  /** Extra commands contributed by the current page, e.g. "Create task" inside a project. */
  register: (id: string, cmds: PageCommand[]) => () => void;
}
export interface PageCommand {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

const Ctx = createContext<PaletteApi | null>(null);
export const usePalette = () => useContext(Ctx);

export function CommandPaletteProvider({
  children,
  signedIn,
  username,
  projects,
}: {
  children: ReactNode;
  signedIn: boolean;
  username?: string;
  projects: SidebarProject[];
}) {
  const [open, setOpen] = useState(false);
  const [pageCommands, setPageCommands] = useState<Record<string, PageCommand[]>>({});
  const router = useRouter();

  useHotkeys({ "mod+k": () => setOpen((o) => !o), "/": () => setOpen(true) });

  const register = useCallback((id: string, cmds: PageCommand[]) => {
    setPageCommands((p) => ({ ...p, [id]: cmds }));
    return () =>
      setPageCommands((p) => {
        const { [id]: _removed, ...rest } = p;
        return rest;
      });
  }, []);

  const api = useMemo(() => ({ open: () => setOpen(true), register }), [register]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Palette
        open={open}
        onOpenChange={setOpen}
        signedIn={signedIn}
        username={username}
        projects={projects}
        pageCommands={Object.values(pageCommands).flat()}
        go={(href) => {
          setOpen(false);
          router.push(href);
        }}
      />
    </Ctx.Provider>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Palette({
  open,
  onOpenChange,
  signedIn,
  username,
  projects,
  pageCommands,
  go,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  signedIn: boolean;
  username?: string;
  projects: SidebarProject[];
  pageCommands: PageCommand[];
  go: (href: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 140);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", query],
    queryFn: () => http.get<SearchResults>(`/search?q=${encodeURIComponent(query)}`),
    enabled: open && query.length > 0,
    staleTime: 10_000,
  });

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const nav: { label: string; href: string; icon: ReactNode; keys?: string }[] = signedIn
    ? [
        { label: "Home", href: "/home", icon: <Home className="size-4" />, keys: "G H" },
        { label: "Inbox", href: "/inbox", icon: <Inbox className="size-4" />, keys: "G I" },
        { label: "Discover projects", href: "/discover", icon: <Compass className="size-4" />, keys: "G D" },
        { label: "Your profile", href: `/${username}`, icon: <User className="size-4" /> },
        { label: "Settings", href: "/settings", icon: <Settings className="size-4" /> },
      ]
    : [{ label: "Discover projects", href: "/discover", icon: <Compass className="size-4" /> }];

  const localProjects = projects.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="animate-overlay fixed inset-0 z-50 bg-black/40" />
        <D.Content
          aria-describedby={undefined}
          className="animate-pop fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-pop focus:outline-none"
        >
          <D.Title className="sr-only">Command menu</D.Title>
          <Command shouldFilter={false} loop label="Command menu">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-faint" aria-hidden />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="Search projects, tasks, people, or type a command"
                className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
              />
              {isFetching && <span className="text-xs text-faint">Searching</span>}
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
                {query ? `Nothing matches "${query}"` : "Start typing to search"}
              </Command.Empty>

              {pageCommands.length > 0 && !query && (
                <Group heading="This page">
                  {pageCommands.map((c) => (
                    <Item key={c.id} value={c.id} onSelect={() => run(c.run)} icon={c.icon ?? <ArrowRight className="size-4" />} hint={c.hint}>
                      {c.label}
                    </Item>
                  ))}
                </Group>
              )}

              {data && data.tasks.length > 0 && (
                <Group heading="Tasks">
                  {data.tasks.map((t) => (
                    <Item
                      key={`${t.project.ownerUsername}/${t.project.slug}#${t.number}`}
                      value={`task-${t.project.ownerUsername}/${t.project.slug}#${t.number}`}
                      onSelect={() => go(`/${t.project.ownerUsername}/${t.project.slug}/tasks?task=${t.number}`)}
                      icon={<StatusIcon status={t.status} />}
                      hint={t.project.name}
                    >
                      <span className="mr-2 font-mono text-xs text-faint">{t.identifier}</span>
                      {t.title}
                    </Item>
                  ))}
                </Group>
              )}

              {data && data.discussions.length > 0 && (
                <Group heading="Discussions">
                  {data.discussions.map((d) => (
                    <Item
                      key={`${d.project.ownerUsername}/${d.project.slug}#${d.number}`}
                      value={`discussion-${d.project.ownerUsername}/${d.project.slug}-${d.number}`}
                      onSelect={() => go(`/${d.project.ownerUsername}/${d.project.slug}/discussions/${d.number}`)}
                      icon={<CategoryIcon category={d.category} solved={d.solved} />}
                      hint={d.project.name}
                    >
                      {d.title}
                    </Item>
                  ))}
                </Group>
              )}

              {signedIn && query && (
                <Group heading="Everything">
                  <Item value={`search-all-${query}`} onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)} icon={<Search className="size-4" />} hint="Enter">
                    Search everything for &ldquo;{query}&rdquo;
                  </Item>
                </Group>
              )}

              {(localProjects.length > 0 || (data?.projects.length ?? 0) > 0) && (
                <Group heading="Projects">
                  {mergeProjects(localProjects, data?.projects ?? [])
                    .slice(0, 8)
                    .map((p) => (
                      <Item
                        key={`${p.ownerUsername}/${p.slug}`}
                        value={`project-${p.ownerUsername}/${p.slug}`}
                        onSelect={() => go(`/${p.ownerUsername}/${p.slug}`)}
                        icon={<StageGlyph stage={p.stage} size={10} />}
                        hint={`${p.ownerUsername}/${p.slug}`}
                      >
                        {p.name}
                      </Item>
                    ))}
                </Group>
              )}

              {data && data.people.length > 0 && (
                <Group heading="People">
                  {data.people.map((u) => (
                    <Item key={u.id} value={`user-${u.username}`} onSelect={() => go(`/${u.username}`)} icon={<Avatar user={u} size={16} />} hint={`@${u.username}`}>
                      {u.displayName}
                    </Item>
                  ))}
                </Group>
              )}

              {!query && (
                <>
                  {signedIn && (
                    <Group heading="Create">
                      <Item value="new-project" onSelect={() => go("/new")} icon={<FolderPlus className="size-4" />}>
                        New project
                      </Item>
                    </Group>
                  )}
                  <Group heading="Go to">
                    {nav.map((n) => (
                      <Item key={n.href} value={`nav-${n.href}`} onSelect={() => go(n.href)} icon={n.icon} keys={n.keys}>
                        {n.label}
                      </Item>
                    ))}
                  </Group>
                  <Group heading="Preferences">
                    <Item
                      value="theme-toggle"
                      onSelect={() =>
                        run(() => {
                          const dark =
                            readTheme() === "dark" ||
                            (readTheme() === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
                          setTheme(dark ? "light" : "dark");
                        })
                      }
                      icon={<ThemeIcon />}
                    >
                      Toggle light and dark
                    </Item>
                  </Group>
                </>
              )}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-border bg-bg-subtle px-3 py-2 text-2xs text-faint">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
              {projects[0] && <span className="ml-auto">Jump to a task by id, like {projects[0].key}-1</span>}
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function ThemeIcon() {
  return <Moon className="size-4" />;
}

type PaletteProject = { name: string; slug: string; ownerUsername: string; stage: SidebarProject["stage"] };
function mergeProjects(a: PaletteProject[], b: PaletteProject[]): PaletteProject[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((p) => {
    const k = `${p.ownerUsername}/${p.slug}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  value,
  onSelect,
  icon,
  hint,
  keys,
}: {
  children: ReactNode;
  value: string;
  onSelect: () => void;
  icon?: ReactNode;
  hint?: string;
  keys?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-sm text-fg data-[selected=true]:bg-surface-hover"
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="max-w-[40%] truncate text-xs text-faint">{hint}</span>}
      {keys && (
        <span className="flex gap-1">
          {keys.split(" ").map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}
