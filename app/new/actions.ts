"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseDocument } from "@/lib/frontmatter";
import { excerpt, readingTime, renderMarkdown } from "@/lib/markdown";
import { generateSlug } from "@/lib/slug";
import { redirect } from "next/navigation";

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
  if (!document) {
    return { errors };
  }

  const shouldPublish = intent === "publish" || document.published;
  const html = await renderMarkdown(document.bodyMarkdown);
  const slug = generateSlug(document.title);

  await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        userId: session.user.id,
        title: document.title,
        slug,
        bodyMarkdown: document.bodyMarkdown,
        processedHtml: html,
        processingState: "READY",
        coverImage: document.coverImage,
        description: excerpt(document.bodyMarkdown),
        readingTime: readingTime(document.bodyMarkdown),
        published: shouldPublish,
        publishedAt: shouldPublish ? new Date() : null,
      },
    });

    for (const name of document.tags) {
      const tag = await tx.tag.upsert({
        where: { name },
        create: { name, bgColorHex: randomTagColor() },
        update: {},
      });
      await tx.postTag.create({ data: { postId: post.id, tagId: tag.id } });
      if (shouldPublish) {
        await tx.tag.update({
          where: { id: tag.id },
          data: { postsCount: { increment: 1 } },
        });
      }
    }

    if (shouldPublish) {
      await tx.user.update({
        where: { id: session.user.id },
        data: { postsCount: { increment: 1 } },
      });
    }
  });

  redirect(`/${session.user.username}/${slug}`);
}

/** Render Markdown for the editor's Preview tab — same pipeline as publish. */
export async function previewMarkdown(source: string): Promise<string> {
  const { document } = parseDocument(source);
  return renderMarkdown(document?.bodyMarkdown ?? "");
}
