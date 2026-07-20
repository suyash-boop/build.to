/**
 * Rebuild the editor's document format (frontmatter + body) from a stored post,
 * so opening a draft round-trips back into the same source the author wrote.
 */
export interface PostDocumentFields {
  title: string;
  coverImage: string | null;
  bodyMarkdown: string;
  tags: string[];
}

/**
 * Quote a YAML scalar when it contains characters that would otherwise change
 * the parse (a colon starts a mapping, leading # a comment, etc.).
 */
function yamlScalar(value: string): string {
  if (!value) return "";
  if (/[:#\[\]{}&*!|>'"%@`,]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function toEditorSource(post: PostDocumentFields): string {
  return [
    "---",
    `title: ${yamlScalar(post.title)}`,
    // `published` is deliberately omitted — the buttons own publish state.
    `tags: ${post.tags.join(", ")}`,
    `cover_image: ${yamlScalar(post.coverImage ?? "")}`,
    "---",
    "",
    post.bodyMarkdown,
    "",
  ].join("\n");
}
