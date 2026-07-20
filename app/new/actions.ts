"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseDocument, type ParsedDocument } from "@/lib/frontmatter";
import { excerpt, readingTime, renderMarkdown } from "@/lib/markdown";
import { enqueueProcessMarkdown } from "@/lib/queues";
import { generateSlug } from "@/lib/slug";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

export type SaveState = { errors: string[] } | null;

// Tag chip accents are assigned on creation; a small fixed palette keeps them
// legible in both themes without a color-picker UI.
const TAG_COLORS = [
  "#3b49df",
  "#0a860a",
  "#b54708",
  "#7c3aed",
  "#be185d",
  "#0e7490",
];

function randomTagColor() {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

/**
 * Replace a post's tag set, keeping Tag.postsCount consistent.
 *
 * `countsApply` is whether this post currently contributes to tag counts (i.e.
 * it is published) — an unpublished draft's tags must not inflate the counts.
 */
async function syncTags(
  tx: Prisma.TransactionClient,
  postId: string,
  tagNames: string[],
  wasCounted: boolean,
  isCounted: boolean,
) {
  const existing = await tx.postTag.findMany({
    where: { postId },
    include: { tag: true },
  });
  const existingNames = existing.map((pt) => pt.tag.name);

  const removed = existing.filter((pt) => !tagNames.includes(pt.tag.name));
  const added = tagNames.filter((n) => !existingNames.includes(n));
  const kept = existing.filter((pt) => tagNames.includes(pt.tag.name));

  for (const pt of removed) {
    await tx.postTag.delete({
      where: { postId_tagId: { postId, tagId: pt.tagId } },
    });
    if (wasCounted) {
      await tx.tag.update({
        where: { id: pt.tagId },
        data: { postsCount: { decrement: 1 } },
      });
    }
  }

  for (const name of added) {
    const tag = await tx.tag.upsert({
      where: { name },
      create: { name, bgColorHex: randomTagColor() },
      update: {},
    });
    await tx.postTag.create({ data: { postId, tagId: tag.id } });
    if (isCounted) {
      await tx.tag.update({
        where: { id: tag.id },
        data: { postsCount: { increment: 1 } },
      });
    }
  }

  // Tags that stayed while the post's published state flipped.
  if (wasCounted !== isCounted) {
    for (const pt of kept) {
      await tx.tag.update({
        where: { id: pt.tagId },
        data: { postsCount: isCounted ? { increment: 1 } : { decrement: 1 } },
      });
    }
  }
}

/**
 * Fields written on the request path. Rendering is NOT done here — the post is
 * saved PENDING and a `process-markdown` job renders it (PRD §6.5), so publish
 * returns immediately instead of blocking on the pipeline.
 *
 * description and readingTime are cheap string operations, so they are computed
 * inline to keep feed cards correct the instant a post is saved; the worker
 * recomputes them from the same source anyway.
 */
function derivedFields(document: ParsedDocument) {
  return {
    title: document.title,
    bodyMarkdown: document.bodyMarkdown,
    processingState: "PENDING" as const,
    coverImage: document.coverImage,
    description: excerpt(document.bodyMarkdown),
    readingTime: readingTime(document.bodyMarkdown),
  };
}

/**
 * Create a post from the editor document (PRD §5.2).
 *
 * Phase 2 renders Markdown synchronously and marks the post READY. Phase 4
 * moves this off the request path into the `process-markdown` worker job —
 * the pipeline in lib/markdown.ts stays the same either way.
 */
export async function createPost(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.username) redirect("/onboarding");

  const source = String(formData.get("source") ?? "");
  const intent = String(formData.get("intent") ?? "publish");

  const { document, errors } = parseDocument(source);
  if (!document) return { errors };

  // The button the author clicked is authoritative. `published:` in the
  // frontmatter is only the default for when no explicit intent was given —
  // otherwise "Save draft" on a document saying `published: true` would
  // publish it, which is the opposite of what the click asked for.
  const shouldPublish =
    intent === "publish" ? true : intent === "draft" ? false : document.published;
  const slug = generateSlug(document.title);

  const created = await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        ...derivedFields(document),
        userId: session.user.id,
        slug,
        published: shouldPublish,
        publishedAt: shouldPublish ? new Date() : null,
      },
    });

    await syncTags(tx, post.id, document.tags, false, shouldPublish);

    if (shouldPublish) {
      await tx.user.update({
        where: { id: session.user.id },
        data: { postsCount: { increment: 1 } },
      });
    }
    return post;
  });

  // Enqueue after the transaction commits — a job enqueued inside it could be
  // picked up before the row is visible to the worker's connection.
  await enqueueProcessMarkdown(created.id);

  // A draft goes back to the editor (where you keep working on it); a published
  // post goes to its public page.
  redirect(
    shouldPublish
      ? `/${session.user.username}/${slug}`
      : `/edit/${created.id}?saved=1`,
  );
}

/**
 * Update an existing post. Used by the edit page and by autosave.
 *
 * Slug is immutable once published (PRD §5.2); an unpublished draft still
 * regenerates its slug from the title so drafts get a sensible URL when they
 * eventually go live.
 */
export async function updatePost(
  postId: string,
  source: string,
  intent: "draft" | "publish" | "autosave",
): Promise<SaveState> {
  const session = await getSession();
  if (!session) redirect("/login");

  const existing = await prisma.post.findUnique({ where: { id: postId } });
  if (!existing) return { errors: ["Post not found."] };
  if (existing.userId !== session.user.id) {
    return { errors: ["You can only edit your own posts."] };
  }

  const { document, errors } = parseDocument(source);
  if (!document) return { errors };

  // Autosave never changes publish state; it only persists content. Otherwise
  // the clicked button wins over the frontmatter's `published:` field.
  const shouldPublish =
    intent === "autosave" ? existing.published : intent === "publish";

  const slug = existing.published
    ? existing.slug
    : generateSlug(document.title);

  await prisma.$transaction(async (tx) => {
    await tx.post.update({
      where: { id: postId },
      data: {
        ...derivedFields(document),
        slug,
        published: shouldPublish,
        publishedAt:
          shouldPublish && !existing.publishedAt
            ? new Date()
            : existing.publishedAt,
      },
    });

    await syncTags(tx, postId, document.tags, existing.published, shouldPublish);

    // Only move the author's counter when the published state actually flips.
    if (existing.published !== shouldPublish) {
      await tx.user.update({
        where: { id: session.user.id },
        data: { postsCount: shouldPublish ? { increment: 1 } : { decrement: 1 } },
      });
    }
  });

  await enqueueProcessMarkdown(postId);

  if (intent === "autosave") return null;
  redirect(
    shouldPublish
      ? `/${session.user.username}/${slug}`
      : `/edit/${postId}?saved=1`,
  );
}

/** Autosave wrapper — persists without navigating. Returns a save timestamp. */
export async function autosavePost(
  postId: string,
  source: string,
): Promise<{ savedAt: number } | { errors: string[] }> {
  const result = await updatePost(postId, source, "autosave");
  if (result?.errors) return { errors: result.errors };
  return { savedAt: Date.now() };
}

/**
 * Create a draft immediately so autosave has a row to write to. Returns the new
 * post id; the editor swaps into "editing" mode without navigating.
 */
export async function createDraft(
  source: string,
): Promise<{ id: string } | { errors: string[] }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.username) redirect("/onboarding");

  const { document, errors } = parseDocument(source);
  if (!document) return { errors };

  const slug = generateSlug(document.title);

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        ...derivedFields(document),
        userId: session.user.id,
        slug,
        published: false,
        publishedAt: null,
      },
    });
    await syncTags(tx, created.id, document.tags, false, false);
    return created;
  });

  await enqueueProcessMarkdown(post.id);

  return { id: post.id };
}

/** Render Markdown for the editor's Preview tab — same pipeline as publish. */
export async function previewMarkdown(source: string): Promise<string> {
  const { document } = parseDocument(source);
  return renderMarkdown(document?.bodyMarkdown ?? "");
}
