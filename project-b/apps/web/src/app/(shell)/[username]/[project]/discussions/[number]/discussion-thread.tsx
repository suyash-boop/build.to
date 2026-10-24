"use client";

import type { DiscussionDetail, DiscussionReplyItem } from "@bldt/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleCheck, Copy, ExternalLink, FileCode2, GitBranch, GitCommitHorizontal, Lock, MoreHorizontal, Pencil, Pin, ThumbsUp, Trash2, Unlock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CATEGORY, CategoryIcon } from "@/components/domain/discussion";
import { Markdown } from "@/components/domain/markdown";
import { MarkdownEditor } from "@/components/domain/markdown-editor";
import { RelativeTime } from "@/components/domain/time";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Avatar, Badge, Panel } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { errorMessage, http } from "@/lib/api.client";
import { cn } from "@/lib/utils";
import { SeenBefore } from "../new/new-discussion";

export function DiscussionThread({ owner, slug, initial }: { owner: string; slug: string; initial: DiscussionDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const key = ["discussion", owner, slug, initial.number] as const;
  const api = `/projects/${owner}/${slug}/discussions/${initial.number}`;
  const { data: d = initial } = useQuery({ queryKey: key, queryFn: () => http.get<DiscussionDetail>(api), initialData: initial });
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: d.title, body: d.body });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  /** Runs a mutation; resolves false on failure so callers keep editors (and drafts) open. */
  const act = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
    if (ok) toast.success(ok);
    await refresh();
    return true;
  };

  const post = async () => {
    if (!reply.trim() || posting) return;
    setPosting(true);
    try {
      await http.post(`${api}/replies`, { body: reply });
      setReply("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const answer = d.replies.find((r) => r.isAnswer);

  return (
    <article className="space-y-6">
      <div>
        <Link href={`/${owner}/${slug}/discussions`} className="inline-flex items-center gap-1 text-xs text-faint hover:text-fg">
          <ArrowLeft className="size-3" /> Discussions
        </Link>
        {editing ? (
          <div className="mt-3 space-y-3">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-lg font-semibold outline-none focus:border-border-strong"
              aria-label="Title"
            />
            <MarkdownEditor value={draft.body} onChange={(body) => setDraft({ ...draft, body })} rows={8} label="Body" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => act(() => http.patch(api, draft), "Saved").then((saved) => saved && setEditing(false))}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight">{d.title}</h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                <span className="flex items-center gap-1">
                  <CategoryIcon category={d.category} solved={d.solved} className="size-3.5" /> {CATEGORY[d.category].label}
                </span>
                {d.solved && <Badge tone="success">Solved</Badge>}
                {d.pinned && (
                  <span className="flex items-center gap-1">
                    <Pin className="size-3" /> Pinned
                  </span>
                )}
                {d.locked && (
                  <span className="flex items-center gap-1">
                    <Lock className="size-3" /> Locked
                  </span>
                )}
                <span>
                  #{d.number} opened by <span className="text-muted">{d.author.displayName}</span> <RelativeTime iso={d.createdAt} />
                </span>
              </p>
            </div>
            {(d.viewer.canEdit || d.viewer.canModerate) && (
              <Menu>
                <MenuTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label="Discussion actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  {d.viewer.canEdit && (
                    <MenuItem
                      onSelect={() => {
                        setDraft({ title: d.title, body: d.body });
                        setEditing(true);
                      }}
                    >
                      <Pencil className="size-3.5 text-faint" /> Edit
                    </MenuItem>
                  )}
                  {d.viewer.canModerate && (
                    <>
                      <MenuItem onSelect={() => act(() => http.patch(api, { pinned: !d.pinned }), d.pinned ? "Unpinned" : "Pinned")}>
                        <Pin className="size-3.5 text-faint" /> {d.pinned ? "Unpin" : "Pin to top"}
                      </MenuItem>
                      <MenuItem onSelect={() => act(() => http.patch(api, { locked: !d.locked }), d.locked ? "Unlocked" : "Locked")}>
                        {d.locked ? <Unlock className="size-3.5 text-faint" /> : <Lock className="size-3.5 text-faint" />} {d.locked ? "Unlock" : "Lock replies"}
                      </MenuItem>
                    </>
                  )}
                  <MenuSeparator />
                  <MenuItem destructive onSelect={() => setConfirmDelete(true)}>
                    <Trash2 className="size-3.5" /> Delete
                  </MenuItem>
                </MenuContent>
              </Menu>
            )}
          </div>
        )}
      </div>

      {d.error && <ErrorCard error={d.error} />}
      {d.similar.length > 0 && <SeenBefore items={d.similar} />}
      {!editing && d.body && (
        <Panel className="px-5 py-4">
          <Markdown>{d.body}</Markdown>
        </Panel>
      )}

      {answer && (
        <a href={`#reply-${answer.id}`} className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/5 px-4 py-3 hover:border-success/50">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Solution from {answer.author.displayName}</span>
            <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{answer.body.replace(/```[\s\S]*?```/g, " (code) ").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 300)}</span>
          </span>
        </a>
      )}

      <section aria-label="Replies" className="space-y-3">
        <h2 className="text-sm font-semibold">
          {d.replies.length === 0 ? "No replies yet" : d.replies.length === 1 ? "1 reply" : `${d.replies.length} replies`}
        </h2>
        {d.replies.map((r) => (
          <Reply key={r.id} r={r} api={api} canAnswer={d.viewer.canAnswer} onChanged={refresh} />
        ))}
      </section>

      {d.viewer.canReply ? (
        <div className="space-y-2">
          <MarkdownEditor value={reply} onChange={setReply} onSubmit={post} rows={5} label="Reply" placeholder={d.category === "HELP" ? "Suggest a fix. Code blocks welcome." : "Write a reply"} />
          <div className="flex items-center justify-end gap-3">
            <span className="text-2xs text-faint">Ctrl+Enter to send</span>
            <Button variant="primary" onClick={post} loading={posting} disabled={!reply.trim()}>
              Reply
            </Button>
          </div>
        </div>
      ) : d.locked ? (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Lock className="size-3.5" /> This discussion is locked.
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this discussion?"
        description="It disappears for everyone, along with its replies."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await http.del(api);
            router.push(`/${owner}/${slug}/discussions`);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </article>
  );
}

function ErrorCard({ error: e }: { error: NonNullable<DiscussionDetail["error"]> }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lines = e.errorMessage.split(/\r?\n/);
  const long = lines.length > 8;
  const shown = expanded || !long ? e.errorMessage : lines.slice(0, 8).join("\n");
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted">
        {e.filePath && (
          <span className="flex items-center gap-1.5 font-mono">
            <FileCode2 className="size-3.5 text-faint" />
            {e.fileUrl ? (
              <a href={e.fileUrl} target="_blank" rel="noopener noreferrer" className="hover:text-fg hover:underline">
                {e.filePath}
                {e.line ? `:${e.line}` : ""}
              </a>
            ) : (
              <>
                {e.filePath}
                {e.line ? `:${e.line}` : ""}
              </>
            )}
          </span>
        )}
        {e.branch && (
          <span className="flex items-center gap-1.5 font-mono">
            <GitBranch className="size-3.5 text-faint" /> {e.branch}
          </span>
        )}
        {e.commitSha && (
          <span className="flex items-center gap-1.5 font-mono">
            <GitCommitHorizontal className="size-3.5 text-faint" />
            {e.commitUrl ? (
              <a href={e.commitUrl} target="_blank" rel="noopener noreferrer" className="hover:text-fg hover:underline">
                {e.commitSha.slice(0, 7)}
              </a>
            ) : (
              e.commitSha.slice(0, 7)
            )}
          </span>
        )}
        {e.language && <span className="text-faint">{e.language}</span>}
        <button
          type="button"
          className="ml-auto flex items-center gap-1 text-faint hover:text-fg"
          onClick={async () => {
            await navigator.clipboard.writeText(e.errorMessage);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy error"}
        </button>
      </div>
      <pre className="overflow-x-auto bg-danger/5 px-4 py-3 font-mono text-xs leading-relaxed text-fg">{shown}</pre>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full border-t border-border py-1.5 text-xs text-faint hover:text-fg">
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
      {e.codeSnippet && (
        <pre className="overflow-x-auto border-t border-border bg-bg-subtle px-4 py-3 font-mono text-xs leading-relaxed text-muted">{e.codeSnippet}</pre>
      )}
      {e.fileUrl && (
        <a href={e.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 border-t border-border px-4 py-2 text-xs text-faint hover:text-fg">
          Open the file at this commit on GitHub <ExternalLink className="size-3" />
        </a>
      )}
    </Panel>
  );
}

function Reply({ r, api, canAnswer, onChanged }: { r: DiscussionReplyItem; api: string; canAnswer: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(r.body);
  const [confirm, setConfirm] = useState(false);
  /** Resolves false on failure so the editor (and the typed body) stays open. */
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
    onChanged();
    return true;
  };
  return (
    <div id={`reply-${r.id}`} className={cn("scroll-mt-20 rounded-lg border bg-surface", r.isAnswer ? "border-success/40" : "border-border")}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <Avatar user={r.author} size={18} />
        <span className="font-medium text-fg">{r.author.displayName}</span>
        <span className="text-faint">
          <RelativeTime iso={r.createdAt} />
          {r.editedAt && " · edited"}
        </span>
        {r.isAnswer && (
          <Badge tone="success" className="ml-1">
            Solution
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {r.canEdit && !editing && (
            <>
              <Button size="icon-sm" variant="ghost" aria-label="Edit reply" onClick={() => setEditing(true)}>
                <Pencil className="size-3" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete reply" onClick={() => setConfirm(true)}>
                <Trash2 className="size-3" />
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="px-4 py-3">
        {editing ? (
          <div className="space-y-2">
            <MarkdownEditor value={body} onChange={setBody} rows={5} label="Edit reply" onSubmit={() => run(() => http.patch(`${api}/replies/${r.id}`, { body })).then((saved) => saved && setEditing(false))} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => run(() => http.patch(`${api}/replies/${r.id}`, { body })).then((saved) => saved && setEditing(false))}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <Markdown>{r.body}</Markdown>
        )}
      </div>
      <div className="flex items-center gap-2 px-4 pb-2.5">
        {r.mine ? (
          r.helpful > 0 && (
            <span className="flex items-center gap-1 px-2 text-xs text-faint tnum">
              <ThumbsUp className="size-3" /> {r.helpful === 1 ? "1 person found this helpful" : `${r.helpful} people found this helpful`}
            </span>
          )
        ) : (
          <Button size="xs" variant="ghost" aria-pressed={r.votedByMe} className={cn(r.votedByMe && "text-fg")} onClick={() => run(() => http.post(`${api}/replies/${r.id}/vote`))}>
            <ThumbsUp className={cn("size-3", r.votedByMe && "fill-current")} /> Helpful{r.helpful > 0 && <span className="tnum"> · {r.helpful}</span>}
          </Button>
        )}
        {canAnswer && (
          <Button size="xs" variant="ghost" onClick={() => run(() => http.post(`${api}/answer`, { replyId: r.isAnswer ? null : r.id }))}>
            <CircleCheck className={cn("size-3", r.isAnswer && "text-success")} /> {r.isAnswer ? "Unmark solution" : "Mark as solution"}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this reply?"
        description={r.isAnswer ? "It is the accepted solution; the discussion becomes unsolved." : undefined}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await run(() => http.del(`${api}/replies/${r.id}`));
        }}
      />
    </div>
  );
}
