"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";
import { CommentForm } from "./CommentForm";
import { deleteComment } from "@/app/actions/comments";
import { MAX_DEPTH, TOMBSTONE } from "@/lib/comment-constants";
import type { CommentNode } from "@/lib/comments";

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function Comment({
  comment,
  postId,
  signedIn,
}: {
  comment: CommentNode;
  postId: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const deleted = comment.bodyMarkdown === TOMBSTONE;

  async function handleDelete() {
    await deleteComment(comment.id);
    router.refresh();
  }

  return (
    <li>
      <div className="flex gap-3">
        <Avatar
          name={comment.author.name}
          src={comment.author.image}
          size="m"
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="rounded-large border border-border bg-body-bg p-3">
            <div className="flex items-baseline gap-2 text-s">
              <Link
                href={`/${comment.author.username}`}
                className="font-medium text-body hover:text-brand"
              >
                {comment.author.name}
              </Link>
              <time
                dateTime={new Date(comment.createdAt).toISOString()}
                className="text-secondary"
              >
                {relativeTime(comment.createdAt)}
              </time>
            </div>
            <div
              className={
                deleted
                  ? "mt-1 text-secondary italic"
                  : "post-body mt-1 text-base"
              }
              // Safe: comment HTML came from lib/markdown.ts (rehypeSanitize).
              dangerouslySetInnerHTML={{ __html: comment.processedHtml }}
            />
          </div>

          <div className="mt-1 flex items-center gap-3 text-s text-secondary">
            {comment.depth < MAX_DEPTH - 1 && !deleted && (
              <button
                type="button"
                onClick={() => setReplying((v) => !v)}
                className="hover:text-body"
              >
                Reply
              </button>
            )}
            {comment.isAuthor && !deleted && (
              <button
                type="button"
                onClick={handleDelete}
                className="hover:text-danger"
              >
                Delete
              </button>
            )}
          </div>

          {replying && (
            <div className="mt-2">
              <CommentForm
                postId={postId}
                parentId={comment.id}
                signedIn={signedIn}
                autoFocus
                onDone={() => setReplying(false)}
                placeholder={`Reply to ${comment.author.name}`}
              />
            </div>
          )}

          {comment.replies.length > 0 && (
            <ul className="mt-3 flex flex-col gap-3 border-l border-border pl-4">
              {comment.replies.map((reply) => (
                <Comment
                  key={reply.id}
                  comment={reply}
                  postId={postId}
                  signedIn={signedIn}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

export function CommentThread({
  comments,
  postId,
  signedIn,
  total,
}: {
  comments: CommentNode[];
  postId: string;
  signedIn: boolean;
  total: number;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-bold">
        {total} {total === 1 ? "comment" : "comments"}
      </h2>

      <div className="mb-6">
        <CommentForm postId={postId} signedIn={signedIn} />
      </div>

      {comments.length > 0 && (
        <ul className="flex flex-col gap-4">
          {comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              postId={postId}
              signedIn={signedIn}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
