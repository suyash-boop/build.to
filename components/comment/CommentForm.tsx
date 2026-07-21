"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addComment } from "@/app/actions/comments";
import { Button, Textarea } from "@/components/ui";

export interface CommentFormProps {
  postId: string;
  parentId?: string | null;
  signedIn: boolean;
  autoFocus?: boolean;
  onDone?: () => void;
  placeholder?: string;
}

export function CommentForm({
  postId,
  parentId = null,
  signedIn,
  autoFocus = false,
  onDone,
  placeholder = "Add a comment",
}: CommentFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!signedIn) {
    return (
      <p className="text-secondary">
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="text-brand underline"
        >
          Sign in
        </button>{" "}
        to join the discussion.
      </p>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const result = await addComment(postId, body, parentId);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBody("");
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus={autoFocus}
        aria-label={parentId ? "Write a reply" : "Write a comment"}
      />
      {error && (
        <p role="alert" className="text-s text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="s" disabled={pending || !body.trim()}>
          {pending ? "Posting…" : parentId ? "Reply" : "Comment"}
        </Button>
        {onDone && (
          <Button type="button" size="s" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
