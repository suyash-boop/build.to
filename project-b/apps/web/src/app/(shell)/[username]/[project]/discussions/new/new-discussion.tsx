"use client";

import type { SimilarError } from "@bldt/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, CircleDot } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useRef, useState } from "react";
import { toast } from "sonner";
import { CATEGORY, type Category } from "@/components/domain/discussion";
import { MarkdownEditor } from "@/components/domain/markdown-editor";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ApiError, errorMessage, http } from "@/lib/api.client";
import { cn } from "@/lib/utils";

export function NewDiscussion({ owner, slug, canAnnounce, initialCategory }: { owner: string; slug: string; canAnnounce: boolean; initialCategory: Category }) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(initialCategory);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState({ errorMessage: "", filePath: "", line: "", branch: "", commitSha: "", codeSnippet: "" });
  const [busy, setBusy] = useState(false);
  // Ctrl+Enter in the editor bypasses the disabled submit button, and state lands a render
  // late: the ref blocks a second post in the same tick and while navigating away.
  const inFlight = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const api = `/projects/${owner}/${slug}/discussions`;

  // While the error is typed or pasted, look for the same error solved before.
  const errorText = useDeferredValue(err.errorMessage.trim());
  const similar = useQuery({
    queryKey: ["discussion-similar", owner, slug, errorText],
    queryFn: () => http.post<{ items: SimilarError[] }>(`${api}/similar`, { errorMessage: errorText }).then((r) => r.items),
    enabled: category === "HELP" && errorText.length > 8,
    staleTime: 60_000,
  });

  const categories = (Object.keys(CATEGORY) as Category[]).filter((c) => c !== "ANNOUNCEMENTS" || canAnnounce);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inFlight.current) return;
    if (title.trim().length < 3) {
      setFieldErrors({ title: "Use at least 3 characters." });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFieldErrors({});
    try {
      const help = category === "HELP" && err.errorMessage.trim();
      const res = await http.post<{ discussion: { number: number } }>(api, {
        category,
        title,
        body,
        ...(help
          ? {
              error: {
                errorMessage: err.errorMessage,
                ...(err.filePath.trim() ? { filePath: err.filePath.trim() } : {}),
                ...(Number(err.line) > 0 ? { line: Number(err.line) } : {}),
                ...(err.branch.trim() ? { branch: err.branch.trim() } : {}),
                ...(err.commitSha.trim() ? { commitSha: err.commitSha.trim() } : {}),
                ...(err.codeSnippet.trim() ? { codeSnippet: err.codeSnippet } : {}),
              },
            }
          : {}),
      });
      router.push(`/${owner}/${slug}/discussions/${res.discussion.number}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) setFieldErrors(error.fieldErrors());
      toast.error(errorMessage(error));
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <Link href={`/${owner}/${slug}/discussions`} className="inline-flex items-center gap-1 text-xs text-faint hover:text-fg">
          <ArrowLeft className="size-3" /> Discussions
        </Link>
        <h1 className="mt-2 text-base font-semibold">New discussion</h1>
      </div>

      <div role="radiogroup" aria-label="Category" className="grid gap-2 sm:grid-cols-2">
        {categories.map((c) => {
          const Icon = CATEGORY[c].icon;
          const on = c === category;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setCategory(c)}
              className={cn("transition-ui flex items-start gap-3 rounded-md border px-3 py-2.5 text-left", on ? "border-fg bg-surface" : "border-border hover:border-border-strong")}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", on ? "text-fg" : "text-faint")} />
              <span>
                <span className="block text-sm font-medium">{CATEGORY[c].label}</span>
                <span className="block text-xs text-muted">{CATEGORY[c].hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Field label="Title" error={fieldErrors.title}>
        {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={category === "HELP" ? "What were you doing when it failed?" : "Title"} required />}
      </Field>

      {category === "HELP" && (
        <div className="space-y-3 rounded-md border border-border bg-bg-subtle p-3">
          <Field label="Error" optional hint="Paste the message and stack trace. Paths and line numbers are fine; they are ignored when matching." error={fieldErrors["error.errorMessage"]}>
            {(id) => <Textarea id={id} value={err.errorMessage} onChange={(e) => setErr({ ...err, errorMessage: e.target.value })} rows={5} spellCheck={false} className="font-mono text-xs" />}
          </Field>
          {similar.data && similar.data.length > 0 && <SeenBefore items={similar.data} />}
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
            <Field label="File" optional error={fieldErrors["error.filePath"]}>
              {(id) => <Input id={id} value={err.filePath} onChange={(e) => setErr({ ...err, filePath: e.target.value })} placeholder="src/routes/user.ts" className="font-mono text-xs" />}
            </Field>
            <Field label="Line" optional>
              {(id) => <Input id={id} value={err.line} onChange={(e) => setErr({ ...err, line: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className="font-mono text-xs" />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Branch" optional>
              {(id) => <Input id={id} value={err.branch} onChange={(e) => setErr({ ...err, branch: e.target.value })} className="font-mono text-xs" />}
            </Field>
            <Field label="Commit" optional error={fieldErrors["error.commitSha"]}>
              {(id) => <Input id={id} value={err.commitSha} onChange={(e) => setErr({ ...err, commitSha: e.target.value })} placeholder="4a1c9e2" className="font-mono text-xs" />}
            </Field>
          </div>
          <Field label="Code around it" optional>
            {(id) => <Textarea id={id} value={err.codeSnippet} onChange={(e) => setErr({ ...err, codeSnippet: e.target.value })} rows={4} spellCheck={false} className="font-mono text-xs" />}
          </Field>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium">{category === "HELP" ? "What you tried" : "Details"}</p>
        <MarkdownEditor value={body} onChange={setBody} onSubmit={() => submit()} rows={8} label="Discussion body" placeholder={category === "HELP" ? "What you expected, what happened, what you already tried." : undefined} />
        {fieldErrors.body && <p className="mt-1 text-xs text-danger">{fieldErrors.body}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" asChild>
          <Link href={`/${owner}/${slug}/discussions`}>Cancel</Link>
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={title.trim().length < 3}>
          {category === "HELP" ? "Ask the team" : category === "ANNOUNCEMENTS" ? "Post announcement" : "Start discussion"}
        </Button>
      </div>
    </form>
  );
}

export function SeenBefore({ items }: { items: SimilarError[] }) {
  const solved = items.filter((i) => i.solved);
  return (
    <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2.5">
      <p className="text-sm font-medium">{solved.length ? "This error was solved before" : "This error has come up before"}</p>
      <ul className="mt-2 space-y-2">
        {items.slice(0, 3).map((s) => (
          <li key={`${s.project.slug}-${s.number}`} className="text-sm">
            <Link href={`/${s.project.ownerUsername}/${s.project.slug}/discussions/${s.number}`} target="_blank" className="flex items-center gap-1.5 hover:underline">
              {s.solved ? <CircleCheck className="size-3.5 shrink-0 text-success" /> : <CircleDot className="size-3.5 shrink-0 text-faint" />}
              <span className="truncate">{s.title}</span>
              <span className="shrink-0 text-xs text-faint">
                {s.project.name} #{s.number}
              </span>
            </Link>
            {s.answer && (
              <p className="ml-5 mt-0.5 line-clamp-2 text-xs text-muted">
                {s.answer.author.displayName}: {s.answer.excerpt}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
