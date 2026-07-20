"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  autosavePost,
  createDraft,
  createPost,
  previewMarkdown,
  updatePost,
  type SaveState,
} from "./actions";
import { EDITOR_TEMPLATE } from "@/lib/frontmatter";
import { Button, Card, Tabs } from "@/components/ui";

const AUTOSAVE_INTERVAL_MS = 30_000; // PRD §5.2

export interface EditorProps {
  /** Existing post id when editing; omitted for a new post. */
  postId?: string;
  /** Existing document source when editing. */
  initialSource?: string;
}

export function Editor({ postId, initialSource }: EditorProps) {
  const [source, setSource] = useState(initialSource ?? EDITOR_TEMPLATE);
  const [tab, setTab] = useState("edit");
  const [preview, setPreview] = useState("");
  // True while a debounced preview render is pending; set by the events that
  // invalidate the preview (typing, switching to the tab), not by the effect.
  const [previewing, setPreviewing] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [autosaving, setAutosaving] = useState(false);

  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    createPost,
    null,
  );

  // The row autosave writes to: the existing post, or a draft created on the
  // first autosave of a new post. State (not just a ref) because the submit
  // buttons must switch from "create" to "update" once a draft exists — a ref
  // alone would leave them stale and publish a duplicate post.
  const [draftId, setDraftId] = useState<string | null>(postId ?? null);
  const draftIdRef = useRef<string | null>(postId ?? null);
  // Content as of the last successful save, so we skip no-op autosaves.
  const lastSavedSourceRef = useRef(initialSource ?? "");
  // Mirrors `source` so the autosave interval and submit handlers read the
  // latest content without needing to re-subscribe on every keystroke.
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  // Preview runs the same pipeline as publish, debounced 500ms (PRD §5.2).
  useEffect(() => {
    if (tab !== "preview") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const html = await previewMarkdown(source);
      if (cancelled) return; // a newer keystroke superseded this render
      setPreview(html);
      setPreviewing(false);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, source]);

  // Autosave every 30s if the content changed (PRD §5.2).
  useEffect(() => {
    const timer = setInterval(async () => {
      const current = sourceRef.current;
      if (current === lastSavedSourceRef.current) return; // nothing changed

      setAutosaving(true);
      try {
        if (draftIdRef.current) {
          const result = await autosavePost(draftIdRef.current, current);
          if ("savedAt" in result) {
            lastSavedSourceRef.current = current;
            setSavedAt(new Date(result.savedAt));
          }
        } else {
          // First autosave of a new post: create the draft row to write into.
          const result = await createDraft(current);
          if ("id" in result) {
            draftIdRef.current = result.id;
            setDraftId(result.id); // flips the buttons to "update" mode
            lastSavedSourceRef.current = current;
            setSavedAt(new Date());
          }
        }
      } finally {
        setAutosaving(false);
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Once a draft exists, submits must update it rather than create a duplicate.
  async function handleSubmit(intent: "draft" | "publish") {
    const id = draftIdRef.current;
    if (!id) return; // no draft yet — the plain form action handles creation
    await updatePost(id, sourceRef.current, intent);
  }

  const isEditing = draftId !== null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="source" value={source} />

      <div className="flex items-end justify-between gap-4">
        <Tabs
          tabs={[
            { value: "edit", label: "Edit" },
            { value: "preview", label: "Preview" },
          ]}
          value={tab}
          onValueChange={(next) => {
            if (next === "preview") setPreviewing(true);
            setTab(next);
          }}
          className="flex-1"
        />
        <p className="pb-2 text-s text-secondary" aria-live="polite">
          {autosaving
            ? "Saving…"
            : savedAt
              ? `Saved ${savedAt.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : ""}
        </p>
      </div>

      {state?.errors?.length ? (
        <div
          role="alert"
          className="rounded border border-danger px-4 py-3 text-s text-danger"
        >
          <ul className="flex flex-col gap-1">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "edit" ? (
        <textarea
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPreviewing(true);
          }}
          spellCheck={false}
          className="min-h-[60vh] w-full rounded border border-border bg-body-bg p-4 font-mono text-base text-body focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Post markdown"
        />
      ) : (
        <Card className="min-h-40 p-6">
          {previewing ? (
            <p className="text-secondary">Rendering…</p>
          ) : (
            <div
              className="post-body"
              // Safe: previewMarkdown runs the same rehypeSanitize pipeline as publish.
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          )}
        </Card>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button
          type={isEditing ? "button" : "submit"}
          variant="outline"
          name="intent"
          value="draft"
          disabled={pending}
          onClick={isEditing ? () => handleSubmit("draft") : undefined}
        >
          Save draft
        </Button>
        <Button
          type={isEditing ? "button" : "submit"}
          name="intent"
          value="publish"
          disabled={pending}
          onClick={isEditing ? () => handleSubmit("publish") : undefined}
        >
          {pending ? "Publishing…" : "Publish"}
        </Button>
      </div>
    </form>
  );
}
