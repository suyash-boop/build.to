"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPost, previewMarkdown, type SaveState } from "./actions";
import { EDITOR_TEMPLATE } from "@/lib/frontmatter";
import { Button, Card, Tabs } from "@/components/ui";

export function Editor() {
  const [source, setSource] = useState(EDITOR_TEMPLATE);
  const [tab, setTab] = useState("edit");
  const [preview, setPreview] = useState("");
  // True while a debounced preview render is pending; set by the events that
  // invalidate the preview (typing, switching to the tab), not by the effect.
  const [previewing, setPreviewing] = useState(true);
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    createPost,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

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

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="source" value={source} />

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
      />

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
        <Card className="min-h-[60vh] p-6">
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
          type="submit"
          variant="outline"
          name="intent"
          value="draft"
          disabled={pending}
        >
          Save draft
        </Button>
        <Button type="submit" name="intent" value="publish" disabled={pending}>
          {pending ? "Publishing…" : "Publish"}
        </Button>
      </div>
    </form>
  );
}
