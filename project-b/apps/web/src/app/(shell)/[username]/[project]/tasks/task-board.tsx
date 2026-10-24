"use client";

import { STATUS_LABEL, type MemberItem, type MilestoneSummary, type TaskStatus, type TaskSummary } from "@bldt/contracts";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GitPullRequest, LayoutGrid, List, MessageSquare, Plus, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PriorityIcon, StatusIcon } from "@/components/domain/status";
import { usePalette } from "@/components/shell/command-palette";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Avatar, Kbd } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { useHotkeys } from "@/lib/hotkeys";
import { useNow } from "@/lib/use-now";
import { cn, dueState, shortDate } from "@/lib/utils";
import { CreateTaskDialog } from "./create-task";
import { AssigneePicker, PriorityPicker, STATUS_ORDER } from "./pickers";
import { TaskPanel } from "./task-panel";
import { useMembers, useMilestones, useTasks, useUpdateTask, type ProjectRef } from "./use-tasks";

const BOARD_COLUMNS: TaskStatus[] = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];
/** Done tasks older than this drop off the board; they stay in List view with the Done filter. */
const DONE_WINDOW_DAYS = 14;
const VIEW_KEY = "bldt:tasks:view";

export function TaskBoard({
  project,
  initialTasks,
  initialMembers,
  initialMilestones,
  canEdit,
  canCreate,
  viewerId,
}: {
  project: ProjectRef;
  initialTasks: TaskSummary[];
  initialMembers: MemberItem[];
  initialMilestones: MilestoneSummary[];
  canEdit: boolean;
  canCreate: boolean;
  viewerId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const palette = usePalette();

  const { data: tasks = [] } = useTasks(project, initialTasks);
  const { data: members = [] } = useMembers(project, initialMembers);
  const { data: milestones = [] } = useMilestones(project, initialMilestones);
  const update = useUpdateTask(project, { members, milestones });

  const [view, setView] = useState<"board" | "list">("board");
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "board" || v === "list") setView(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const changeView = (v: "board" | "list") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const [q, setQ] = useState("");
  const assignee = search.get("assignee"); // "me" | "none" | userId
  const milestone = search.get("milestone");
  const [createOpen, setCreateOpen] = useState<{ status: TaskStatus } | null>(null);

  const openTask = search.get("task") ? Number(search.get("task")) : null;
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const sp = new URLSearchParams(search.toString());
      if (value == null) sp.delete(key);
      else sp.set(key, value);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, search],
  );

  useHotkeys({ c: () => canCreate && setCreateOpen({ status: "TODO" }) }, !openTask);

  useEffect(() => {
    if (!palette || !canCreate) return;
    return palette.register("tasks", [{ id: "create-task", label: "Create task", hint: "C", icon: <Plus className="size-4" />, run: () => setCreateOpen({ status: "TODO" }) }]);
  }, [palette, canCreate]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const idMatch = /^(?:[a-z][a-z0-9]*-)?(\d+)$/i.exec(needle);
    return tasks.filter((t) => {
      if (assignee === "me" && t.assignee?.id !== viewerId) return false;
      if (assignee === "none" && t.assignee) return false;
      if (assignee && assignee !== "me" && assignee !== "none" && t.assignee?.id !== assignee) return false;
      if (milestone === "none" && t.milestone) return false;
      if (milestone && milestone !== "none" && t.milestone?.id !== milestone) return false;
      if (needle && !(t.title.toLowerCase().includes(needle) || (idMatch && t.number === Number(idMatch[1])))) return false;
      return true;
    });
  }, [tasks, q, assignee, milestone, viewerId]);

  const assigneeLabel =
    assignee === "me" ? "Assigned to me" : assignee === "none" ? "Unassigned" : assignee ? (members.find((m) => m.user.id === assignee)?.user.displayName ?? "Assignee") : null;
  const milestoneLabel = milestone === "none" ? "No milestone" : milestone ? (milestones.find((m) => m.id === milestone)?.title ?? "Milestone") : null;

  return (
    <div className="flex min-h-[calc(100dvh-140px)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
        <Segmented
          size="sm"
          value={view}
          onChange={changeView}
          options={[
            { value: "board", label: <><LayoutGrid className="size-3.5" /> Board</> },
            { value: "list", label: <><List className="size-3.5" /> List</> },
          ]}
        />
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant={assignee ? "secondary" : "ghost"}>{assigneeLabel ?? "Assignee"}</Button>
          </MenuTrigger>
          <MenuContent align="start" className="w-56">
            <MenuItem onSelect={() => setParam("assignee", null)}>Everyone</MenuItem>
            <MenuItem onSelect={() => setParam("assignee", "me")}>Assigned to me</MenuItem>
            <MenuItem onSelect={() => setParam("assignee", "none")}>Unassigned</MenuItem>
            <MenuSeparator />
            <MenuLabel>Members</MenuLabel>
            {members.filter((m) => m.role !== "VIEWER").map((m) => (
              <MenuItem key={m.user.id} onSelect={() => setParam("assignee", m.user.id)}>
                <Avatar user={m.user} size={16} /> {m.user.displayName}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        {milestones.length > 0 && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant={milestone ? "secondary" : "ghost"}>{milestoneLabel ?? "Milestone"}</Button>
            </MenuTrigger>
            <MenuContent align="start" className="w-56">
              <MenuItem onSelect={() => setParam("milestone", null)}>Any milestone</MenuItem>
              <MenuItem onSelect={() => setParam("milestone", "none")}>No milestone</MenuItem>
              <MenuSeparator />
              {milestones.map((m) => (
                <MenuItem key={m.id} onSelect={() => setParam("milestone", m.id)}>{m.title}</MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}
        {(assignee || milestone) && (
          <Button size="sm" variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>
            <X className="size-3.5" /> Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="w-44 sm:w-56">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title or id" leading={<Search className="mr-2 size-3.5" />} aria-label="Filter tasks" />
          </div>
          {canCreate && (
            <Button size="sm" variant="primary" onClick={() => setCreateOpen({ status: "TODO" })}>
              <Plus className="size-3.5" /> New task <Kbd className="ml-0.5 border-primary-fg/20 bg-transparent text-primary-fg/70">C</Kbd>
            </Button>
          )}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-16">
          <div className="max-w-sm text-center">
            <p className="text-sm font-medium">No tasks yet</p>
            <p className="mt-1 text-sm text-muted">
              Tasks are numbered <span className="font-mono">{project.key}-1</span>, <span className="font-mono">{project.key}-2</span> and so on. Mention one in a pull
              request and it moves on its own.
            </p>
            {canCreate && (
              <Button className="mt-4" size="sm" variant="primary" onClick={() => setCreateOpen({ status: "TODO" })}>
                <Plus className="size-3.5" /> Create the first task
              </Button>
            )}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
          <div>
            <p className="text-sm font-medium">No tasks match these filters</p>
            <Button className="mt-3" size="sm" onClick={() => { setQ(""); router.replace(pathname, { scroll: false }); }}>Clear filters</Button>
          </div>
        </div>
      ) : view === "board" ? (
        <Board
          project={project}
          tasks={filtered}
          canEdit={canEdit}
          onOpen={(n) => setParam("task", String(n))}
          onCreate={canCreate ? (status) => setCreateOpen({ status }) : undefined}
          onMove={(task, status, beforeId, afterId, position) =>
            update.mutate({ number: task.number, patch: { status, move: { beforeId, afterId } }, optimisticPosition: position })
          }
          members={members}
          onPatch={(n, patch) => update.mutate({ number: n, patch })}
        />
      ) : (
        <ListView tasks={filtered} project={project} onOpen={(n) => setParam("task", String(n))} members={members} canEdit={canEdit} onPatch={(n, patch) => update.mutate({ number: n, patch })} />
      )}

      {createOpen && (
        <CreateTaskDialog
          project={project}
          members={members}
          milestones={milestones}
          defaultStatus={createOpen.status}
          defaultMilestoneId={milestone && milestone !== "none" ? milestone : null}
          onClose={() => setCreateOpen(null)}
        />
      )}
      {openTask != null && (
        <TaskPanel project={project} number={openTask} members={members} milestones={milestones} canEdit={canEdit} onClose={() => setParam("task", null)} />
      )}
    </div>
  );
}

/* ── Board ────────────────────────────────────────────────── */

function recentEnough(t: TaskSummary) {
  if (t.status !== "DONE" || !t.completedAt) return true;
  return Date.now() - new Date(t.completedAt).getTime() < DONE_WINDOW_DAYS * 86400_000;
}

function Board({
  project,
  tasks,
  canEdit,
  onOpen,
  onCreate,
  onMove,
  members,
  onPatch,
}: {
  project: ProjectRef;
  tasks: TaskSummary[];
  canEdit: boolean;
  onOpen: (n: number) => void;
  onCreate?: (s: TaskStatus) => void;
  onMove: (t: TaskSummary, status: TaskStatus, beforeId: string | null, afterId: string | null, position: number) => void;
  members: MemberItem[];
  onPatch: (n: number, patch: Parameters<ReturnType<typeof useUpdateTask>["mutate"]>[0]["patch"]) => void;
}) {
  // Local column state during a drag so cards can move between columns before the drop.
  const grouped = useMemo(() => {
    const g = Object.fromEntries(BOARD_COLUMNS.map((s) => [s, [] as TaskSummary[]])) as Record<TaskStatus, TaskSummary[]>;
    for (const t of tasks) if (g[t.status] && recentEnough(t)) g[t.status].push(t);
    for (const s of BOARD_COLUMNS) g[s].sort((a, b) => a.position - b.position);
    return g;
  }, [tasks]);
  const [columns, setColumns] = useState(grouped);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId) setColumns(grouped);
  }, [grouped, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (id: string): TaskStatus | null => {
    if ((BOARD_COLUMNS as string[]).includes(id)) return id as TaskStatus;
    return BOARD_COLUMNS.find((s) => columns[s].some((t) => t.id === id)) ?? null;
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragOver = (e: DragOverEvent) => {
    const from = findColumn(String(e.active.id));
    const to = e.over ? findColumn(String(e.over.id)) : null;
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const moving = cols[from].find((t) => t.id === e.active.id);
      if (!moving) return cols;
      const target = cols[to];
      const overIndex = target.findIndex((t) => t.id === e.over!.id);
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...cols,
        [from]: cols[from].filter((t) => t.id !== moving.id),
        [to]: [...target.slice(0, index), { ...moving, status: to }, ...target.slice(index)],
      };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    setActiveId(null);
    const col = findColumn(id);
    if (!col || !e.over) return setColumns(grouped);
    let list = columns[col];
    const oldIndex = list.findIndex((t) => t.id === id);
    const overIndex = list.findIndex((t) => t.id === e.over!.id);
    if (overIndex >= 0 && overIndex !== oldIndex) {
      const copy = [...list];
      const [m] = copy.splice(oldIndex, 1);
      copy.splice(overIndex, 0, m!);
      list = copy;
    }
    const index = list.findIndex((t) => t.id === id);
    const before = list[index - 1] ?? null;
    const after = list[index + 1] ?? null;
    const original = tasks.find((t) => t.id === id)!;
    if (original.status === col && list === columns[col] && overIndex === oldIndex) return;
    const position =
      before && after ? (before.position + after.position) / 2 : before ? before.position + 1024 : after ? after.position - 1024 : 1024;
    setColumns({ ...columns, [col]: list });
    onMove(original, col, before?.id ?? null, after?.id ?? null, position);
  };

  const active = activeId ? tasks.find((t) => t.id === activeId) : null;

  return (
    <DndContext id="task-board" sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setColumns(grouped); }}>
      <div className="flex flex-1 gap-3 overflow-x-auto px-4 py-4 md:px-6">
        {BOARD_COLUMNS.map((status) => (
          <Column key={status} status={status} tasks={columns[status]} onCreate={onCreate}>
            <SortableContext items={columns[status].map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {columns[status].map((t) => (
                <SortableCard key={t.id} task={t} disabled={!canEdit}>
                  {(handle) => <Card task={t} project={project} onOpen={onOpen} members={members} canEdit={canEdit} onPatch={onPatch} handle={handle} />}
                </SortableCard>
              ))}
            </SortableContext>
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
        {active ? <Card task={active} project={project} onOpen={() => {}} members={members} canEdit={false} onPatch={() => {}} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ status, tasks, children, onCreate }: { status: TaskStatus; tasks: TaskSummary[]; children: React.ReactNode; onCreate?: (s: TaskStatus) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section className="flex w-[256px] shrink-0 flex-col" aria-label={STATUS_LABEL[status]}>
      <header className="mb-2 flex h-7 items-center gap-2 px-1">
        <StatusIcon status={status} />
        <h3 className="text-sm font-medium">{STATUS_LABEL[status]}</h3>
        <span className="text-xs text-faint tnum">{tasks.length}</span>
        {onCreate && (
          <button onClick={() => onCreate(status)} className="ml-auto rounded p-0.5 text-faint hover:bg-surface-hover hover:text-fg" aria-label={`New task in ${STATUS_LABEL[status]}`}>
            <Plus className="size-3.5" />
          </button>
        )}
      </header>
      <div ref={setNodeRef} className={cn("flex min-h-24 flex-1 flex-col gap-1.5 rounded-lg p-1 transition-colors", isOver && "bg-surface-2")}>
        {children}
      </div>
    </section>
  );
}

/** Drag wiring handed to the card, which is both the focus target and the drag activator. */
interface DragHandle {
  ref: (el: HTMLElement | null) => void;
  listeners: ReturnType<typeof useSortable>["listeners"];
  describedBy: string | undefined;
  /** Mid drag: Enter drops the card rather than opening it. */
  sorting: boolean;
}

function SortableCard({ task, disabled, children }: { task: TaskSummary; disabled: boolean; children: (handle: DragHandle) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-30")}>
      {children({ ref: setActivatorNodeRef, listeners, describedBy: disabled ? undefined : attributes["aria-describedby"], sorting: isDragging })}
    </div>
  );
}

function Card({
  task: t,
  project,
  onOpen,
  members,
  canEdit,
  onPatch,
  dragging,
  handle,
}: {
  task: TaskSummary;
  project: ProjectRef;
  onOpen: (n: number) => void;
  members: MemberItem[];
  canEdit: boolean;
  onPatch: (n: number, patch: Parameters<ReturnType<typeof useUpdateTask>["mutate"]>[0]["patch"]) => void;
  dragging?: boolean;
  handle?: DragHandle;
}) {
  const now = useNow();
  const due = dueState(t.dueOn, now);
  return (
    <div
      ref={handle?.ref}
      {...handle?.listeners}
      role="button"
      tabIndex={dragging ? -1 : 0}
      aria-describedby={handle?.describedBy}
      onClick={() => onOpen(t.number)}
      onKeyDown={(e) => {
        // Keys from pickers inside the card are not ours, and keys mid drag belong to dnd-kit.
        if (e.target !== e.currentTarget || handle?.sorting) return;
        // Enter opens the task; Space starts a keyboard drag.
        if (e.key === "Enter") onOpen(t.number);
        else handle?.listeners?.onKeyDown?.(e);
      }}
      className={cn(
        "transition-ui group cursor-pointer rounded-md border border-border bg-surface px-3 py-2.5 text-left hover:-translate-y-px hover:border-border-strong hover:shadow-[0_4px_12px_-6px_rgb(0_0_0/0.35)]",
        dragging && "rotate-[0.6deg] border-border-strong shadow-pop",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-2xs text-faint">{t.identifier}{t.github && <span className="ml-1">· #{t.github.number}</span>}</span>
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <AssigneePicker value={t.assignee} members={members} onChange={(id) => onPatch(t.number, { assigneeId: id })} compact disabled={!canEdit} />
        </span>
      </div>
      <p className={cn("mt-1 text-sm leading-5", t.status === "DONE" && "text-muted")}>{t.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-faint" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {(t.priority !== "NONE" || canEdit) && (
          <span className={t.priority === "NONE" ? "opacity-0 transition-opacity group-hover:opacity-100" : ""}>
            <PriorityPicker value={t.priority} onChange={(p) => onPatch(t.number, { priority: p })} compact disabled={!canEdit} />
          </span>
        )}
        {t.milestone && <span className="truncate rounded-sm border border-border px-1.5 py-px">{t.milestone.title}</span>}
        {t.dueOn && (
          <span className={cn("tnum", due === "overdue" ? "text-danger" : due === "soon" ? "text-warning" : "")}>{shortDate(t.dueOn)}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {t.prCount > 0 && (
            <span className="flex items-center gap-0.5" title={`${t.prCount} linked pull request${t.prCount > 1 ? "s" : ""}`}>
              <GitPullRequest className="size-3" /> {t.prCount}
            </span>
          )}
          {t.commentCount > 0 && (
            <span className="flex items-center gap-0.5" title={`${t.commentCount} comments`}>
              <MessageSquare className="size-3" /> {t.commentCount}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/* ── List ─────────────────────────────────────────────────── */

function ListView({
  tasks,
  onOpen,
  members,
  canEdit,
  onPatch,
}: {
  tasks: TaskSummary[];
  project: ProjectRef;
  onOpen: (n: number) => void;
  members: MemberItem[];
  canEdit: boolean;
  onPatch: (n: number, patch: Parameters<ReturnType<typeof useUpdateTask>["mutate"]>[0]["patch"]) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(new Set(["CANCELED"]));
  const now = useNow();
  return (
    <div className="pb-10">
      {STATUS_ORDER.map((status) => {
        const rows = tasks.filter((t) => t.status === status).sort((a, b) => a.position - b.position);
        if (rows.length === 0) return null;
        const isCollapsed = collapsed.has(status);
        return (
          <section key={status}>
            <button
              onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(status)) n.delete(status); else n.add(status); return n; })}
              className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-b border-border bg-bg-subtle px-4 text-left text-sm md:px-6"
              aria-expanded={!isCollapsed}
            >
              <StatusIcon status={status} />
              <span className="font-medium">{STATUS_LABEL[status]}</span>
              <span className="text-xs text-faint tnum">{rows.length}</span>
            </button>
            {!isCollapsed &&
              rows.map((t) => {
                const due = dueState(t.dueOn, now);
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(t.number)}
                    onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && onOpen(t.number)}
                    className="flex h-10 cursor-pointer items-center gap-2 border-b border-border px-4 text-sm hover:bg-surface-hover md:px-6"
                  >
                    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <PriorityPicker value={t.priority} onChange={(p) => onPatch(t.number, { priority: p })} compact disabled={!canEdit} />
                    </span>
                    <span className="w-20 shrink-0 font-mono text-xs text-faint">{t.identifier}</span>
                    <span className={cn("min-w-0 flex-1 truncate", t.status === "DONE" && "text-muted")}>{t.title}</span>
                    {t.prCount > 0 && <GitPullRequest className="size-3.5 shrink-0 text-faint" aria-label="Has linked pull requests" />}
                    {t.milestone && <span className="hidden max-w-36 shrink-0 truncate rounded-sm border border-border px-1.5 text-2xs text-faint md:inline">{t.milestone.title}</span>}
                    {t.dueOn && <span className={cn("hidden w-14 shrink-0 text-right text-xs tnum sm:inline", due === "overdue" ? "text-danger" : due === "soon" ? "text-warning" : "text-faint")}>{shortDate(t.dueOn)}</span>}
                    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <AssigneePicker value={t.assignee} members={members} onChange={(id) => onPatch(t.number, { assigneeId: id })} compact disabled={!canEdit} />
                    </span>
                  </div>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
