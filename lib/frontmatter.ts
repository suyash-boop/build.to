import matter from "gray-matter";

/**
 * Editor document format (PRD §5.2): a YAML frontmatter block followed by the
 * Markdown body.
 *
 *   ---
 *   title: My post title
 *   published: false
 *   tags: javascript, webdev
 *   cover_image: https://example.com/cover.jpg
 *   ---
 *
 *   Body content starts here.
 */

export const MAX_TAGS = 4;
const TAG_PATTERN = /^[a-z0-9]{1,24}$/;
const MAX_TITLE_LENGTH = 128;

export interface ParsedDocument {
  title: string;
  published: boolean;
  tags: string[];
  coverImage: string | null;
  bodyMarkdown: string;
}

export interface ParseResult {
  document: ParsedDocument | null;
  errors: string[];
}

export const EDITOR_TEMPLATE = `---
title:
published: false
tags:
cover_image:
---

Write your post here, in **Markdown**.
`;

/** Parse and validate an editor document. Never throws — returns errors. */
export function parseDocument(source: string): ParseResult {
  const errors: string[] = [];

  let data: Record<string, unknown>;
  let content: string;
  try {
    const parsed = matter(source);
    data = parsed.data as Record<string, unknown>;
    content = parsed.content;
  } catch {
    return {
      document: null,
      errors: ["Frontmatter is not valid YAML. Check the block at the top."],
    };
  }

  const title = String(data.title ?? "").trim();
  if (!title) {
    errors.push("Title is required.");
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }

  const bodyMarkdown = content.trim();
  if (!bodyMarkdown) {
    errors.push("Body is required.");
  }

  // tags: comma-separated, trimmed, lowercased, max 4 (PRD §5.2)
  const rawTags = data.tags;
  const tagList =
    typeof rawTags === "string"
      ? rawTags.split(",")
      : Array.isArray(rawTags)
        ? rawTags.map(String)
        : [];
  const tags = tagList.map((t) => t.trim().toLowerCase()).filter(Boolean);

  if (tags.length > MAX_TAGS) {
    errors.push(`Use at most ${MAX_TAGS} tags.`);
  }
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag)) {
      errors.push(
        `Tag "${tag}" is invalid — use lowercase letters and numbers, up to 24 characters.`,
      );
    }
  }

  const coverRaw = data.cover_image;
  const coverImage =
    typeof coverRaw === "string" && coverRaw.trim() ? coverRaw.trim() : null;

  if (errors.length > 0) {
    return { document: null, errors };
  }

  return {
    document: {
      title,
      published: data.published === true,
      tags: [...new Set(tags)],
      coverImage,
      bodyMarkdown,
    },
    errors: [],
  };
}
