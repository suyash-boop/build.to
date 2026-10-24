"use client";

import type { CommentItem, MemberItem, MilestoneSummary, TaskDetail } from "@bldt/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog as D } from "radix-ui";
import { Check, Copy, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Link2, MoreHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActivityFeed } from "@/components/domain/activity";
import { GithubMark } from "@/components/domain/logo";
import { Markdown } from "@/components/domain/markdown";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar, Skeleton } from "@/components/ui/misc";
import { ModKey } from "@/components/ui/mod-key";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from "@/components/ui/overlay";
import { errorMessage, http } from "@/lib/api.client";
import { cn, fullDate } from "@/lib/utils";
import { AssigneePicker, DueDateInput, MilestonePicker, PriorityPicker, StatusPicker } from "./pickers";
import { api, keys, useTaskDetail, useUpdateTask, type ProjectRef } from "./use-tasks";

export function TaskPanel({
  project,
  number,
  members,
  milestones,
  canEdit,
  onClose,
}: {
  project: ProjectRef;
  number: number;
  members: MemberItem[];
  milestones: MilestoneSummary[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const { data: task, isPending, isError, error } = useTaskDetail(project, number);
  const update = useUpdateTask(project, { members, milestones });
  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) => update.mutate({ number, patch: p });

  return (
    <D.Root open onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="animate-overlay fixed inset-0 z-40 bg-black/30" />
        <D.Content
          aria-describedby={undefined}
          // Focus the sheet itself, not the close button, so no ring flashes on open.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          // Radix listens for Escape on the document in the capture phase, before the
          // editor sees it. Inside an open editor, Escape cancels the edit, not the sheet.
          onEscapeKeyDown={(e) => {
            if (e.target instanceof Element && e.target.closest("[data-escape-local]")) e.preventDefault();
          }}
          tabIndex={-1}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[880px] flex-col border-l border-border bg-bg shadow-pop focus:outline-none animate-sheet"
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <D.Title className="font-mono text-xs text-muted">{task?.identifier ?? `${project.key}-${number}`}</D.Title>
            {task && <CopyLink identifier={task.identifier} />}
            {task?.github && (
              <a
                href={task.github.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-2xs text-faint hover:bg-surface-hover hover:text-fg"
                title="This task mirrors a GitHub issue. Its title, description, and open or closed state follow GitHub."
              >
                <GithubMark className="size-3" /> #{task.github.number}
              </a>
            )}
            <div className="ml-auto flex items-center gap-1">
              {task && canEdit && <TaskMenu project={project} task={task} onDeleted={onClose} />}
              <D.Close className="rounded-md p-1.5 text-faint hover:bg-surface-hover hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </D.Close>
            </div>
          </header>

          {isPending ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : isError ? (
            <div className="p-6 text-sm text-muted">{errorMessage(error)}</div>
          ) : (
            <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_240px] md:overflow-hidden">
              <div className="min-w-0 px-6 py-5 md:overflow-y-auto">
                <EditableTitle value={task.title} canEdit={canEdit} onSave={(title) => patch({ title })} />
                <Description project={project} task={task} canEdit={canEdit} />

                {task.pullRequests.length > 0 && (
                  <section className="mt-8">
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Pull requests</h3>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {task.pullRequests.map((pr) => (
                        <li key={`${pr.repoFullName}#${pr.number}`}>
                          <a href={pr.htmlUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-hover">
                            <PrIcon state={pr.state} draft={pr.isDraft} />
                            <span className="min-w-0 flex-1 truncate">{pr.title}</span>
                            {pr.closes && (
                              <Tooltip content="Uses a closing keyword: merging it completes this task">
                                <span className="rounded-sm border border-border px-1 text-2xs text-faint">closes</span>
                              </Tooltip>
                            )}
                            <span className="shrink-0 font-mono text-xs text-faint">{pr.repoFullName.split("/")[1]}#{pr.number}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <Comments project={project} task={task} canComment={canEdit} />

                {task.history.length > 0 && (
                  <section className="mt-8">
                    <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">History</h3>
                    <ActivityFeed items={task.history} compact />
                  </section>
                )}
              </div>

              <aside className="border-t border-border bg-bg-subtle px-4 py-5 md:overflow-y-auto md:border-l md:border-t-0">
                <dl className="space-y-3 text-sm">
                  <Prop label="Status"><StatusPicker value={task.status} onChange={(status) => patch({ status })} disabled={!canEdit} /></Prop>
                  <Prop label="Priority"><PriorityPicker value={task.priority} onChange={(priority) => patch({ priority })} disabled={!canEdit} /></Prop>
                  <Prop label="Assignee"><AssigneePicker value={task.assignee} members={members} onChange={(assigneeId) => patch({ assigneeId })} disabled={!canEdit} /></Prop>
                  <Prop label="Milestone"><MilestonePicker value={task.milestone} milestones={milestones} onChange={(milestoneId) => patch({ milestoneId })} disabled={!canEdit} /></Prop>
                  <Prop label="Due"><DueDateInput value={task.dueOn} onChange={(dueOn) => patch({ dueOn })} disabled={!canEdit} /></Prop>
                </dl>
                <div className="mt-6 space-y-1.5 border-t border-border pt-4 text-xs text-faint">
                  <p className="flex items-center gap-1.5">
                    Created by <Avatar user={task.creator} size={14} /> <span className="text-muted">{task.creator.displayName}</span>
                  </p>
                  <p title={fullDate(task.createdAt)}>Created <RelativeTime iso={task.createdAt} /></p>
                  {task.startedAt && <p title={fullDate(task.startedAt)}>Started <RelativeTime iso={task.startedAt} /></p>}
                  {task.completedAt && <p title={fullDate(task.completedAt)}>Closed <RelativeTime iso={task.completedAt} /></p>}
                </div>
                <div className="mt-6 rounded-md border border-border bg-surface px-3 py-2.5 text-xs text-muted">
                  Reference <span className="font-mono text-fg">{task.identifier}</span> in a branch or PR to link it. Write{" "}
                  <span className="font-mono text-fg">fixes {task.identifier}</span> to close it on merge.
                </div>
              </aside>
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="-ml-2 min-w-0">{children}</dd>
    </div>
  );
}

function PrIcon({ state, draft }: { state: "OPEN" | "CLOSED" | "MERGED"; draft: boolean }) {
  if (state === "MERGED") return <GitMerge className="size-4 shrink-0 text-st-shipped" aria-label="Merged" />;
  if (state === "CLOSED") return <GitPullRequestClosed className="size-4 shrink-0 text-danger" aria-label="Closed" />;
  if (draft) return <GitPullRequestDraft className="size-4 shrink-0 text-faint" aria-label="Draft" />;
  return <GitPullRequest className="size-4 shrink-0 text-st-building" aria-label="Open" />;
}

function CopyLink({ identifier }: { identifier: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tooltip content="Copy link">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(window.location.href);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
        className="rounded p-1 text-faint hover:bg-surface-hover hover:text-fg"
        aria-label={`Copy link to ${identifier}`}
      >
        {done ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
      </button>
    </Tooltip>
  );
}

function TaskMenu({ project, task, onDeleted }: { project: ProjectRef; task: TaskDetail; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      title={`Delete ${task.identifier}?`}
      description="The task, its comments, and its links to pull requests are removed. This cannot be undone."
      confirmLabel="Delete task"
      destructive
      onConfirm={async () => {
        await http.del(`${api(project)}/tasks/${task.number}`);
        qc.setQueryData<{ id: string }[]>(keys.tasks(project), (old) => old?.filter((t) => t.id !== task.id));
        toast.success(`${task.identifier} deleted`);
        onDeleted();
      }}
    />
    <Menu>
      <MenuTrigger className="rounded-md p-1.5 text-faint hover:bg-surface-hover hover:text-fg" aria-label="Task actions">
        <MoreHorizontal className="size-4" />
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => navigator.clipboard.writeText(task.identifier).then(() => toast.success("Copied"))}>
          <Copy className="size-4 text-muted" /> Copy id
        </MenuItem>
        <MenuItem onSelect={() => navigator.clipboard.writeText(`${task.identifier.toLowerCase()}-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-$/, "")}`).then(() => toast.success("Branch name copied"))}>
          <GitPullRequest className="size-4 text-muted" /> Copy branch name
        </MenuItem>
        <MenuSeparator />
        <MenuItem destructive onSelect={() => setConfirming(true)}>
          <Trash2 className="size-4" /> Delete task
        </MenuItem>
      </MenuContent>
    </Menu>
    </>
  );
}

function EditableTitle({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Set by Escape so the blur that follows discards the edit instead of saving it.
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  if (!canEdit) return <h2 className="text-lg font-semibold leading-7">{value}</h2>;
  const commit = () => {
    const v = draft.trim();
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          setDraft(value);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      data-escape-local=""
      rows={1}
      maxLength={200}
      aria-label="Title"
      className="field-sizing-content w-full resize-none rounded-md bg-transparent text-lg font-semibold leading-7 outline-none -mx-1 px-1 hover:bg-surface-hover/60 focus:bg-surface-hover/60"
    />
  );
}

function Description({ project, task, canEdit }: { project: ProjectRef; task: TaskDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(task.description ?? "");
  }, [task.description, editing]);

  const save = async () => {
    setBusy(true);
    try {
      await http.patch(`${api(project)}/tasks/${task.number}`, { description: draft });
      await qc.invalidateQueries({ queryKey: keys.task(project, task.number) });
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="mt-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          autoFocus
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          data-escape-local=""
          placeholder="Markdown supported"
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} onClick={save}>Save <ModKey k="↵" className="ml-1 border-primary-fg/20 bg-transparent text-primary-fg/70" /></Button>
        </div>
      </div>
    );
  }
  if (!task.description) {
    return canEdit ? (
      <button onClick={() => setEditing(true)} className="mt-3 block w-full rounded-md px-1 py-2 text-left text-sm text-faint hover:bg-surface-hover/60 -mx-1">
        Add a description
      </button>
    ) : null;
  }
  return (
    <div
      className={cn("mt-3 rounded-md -mx-2 px-2 py-1", canEdit && "cursor-text hover:bg-surface-hover/40")}
      onClick={(e) => {
        if (!canEdit || (e.target as HTMLElement).closest("a")) return;
        setEditing(true);
      }}
    >
      <Markdown>{task.description}</Markdown>
    </div>
  );
}

function Comments({ project, task, canComment }: { project: ProjectRef; task: TaskDetail; canComment: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  // State updates land a render late; the ref stops a same-tick double send (Ctrl+Enter held).
  const inFlight = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    if (!body.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const c = await http.post<CommentItem>(`${api(project)}/tasks/${task.number}/comments`, { body: body.trim() });
      qc.setQueryData<TaskDetail>(keys.task(project, task.number), (old) => (old ? { ...old, comments: [...old.comments, c] } : old));
      setBody("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="mt-8">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">Discussion</h3>
      {task.comments.length > 0 && (
        <ul className="space-y-4">
          {task.comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar user={c.author} size={22} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-medium text-fg">{c.author.displayName}</span>{" "}
                  <RelativeTime iso={c.createdAt} className="text-faint" />
                  {c.editedAt && <span className="text-faint"> · edited</span>}
                </p>
                <Markdown className="mt-1 text-sm">{c.body}</Markdown>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <div className="mt-4 rounded-lg border border-border bg-surface focus-within:border-border-strong">
          <textarea
            ref={ref}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
            }}
            rows={3}
            placeholder="Leave a comment. @mention a teammate to notify them."
            aria-label="Comment"
            className="block w-full resize-none rounded-t-lg bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-faint"
          />
          <div className="flex justify-end border-t border-border px-2 py-1.5">
            <Button size="sm" variant="primary" disabled={!body.trim()} loading={busy} onClick={send}>
              Comment
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
