import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";

/**
 * The single Markdown pipeline (PRD §6.3). Imported by BOTH the editor preview
 * route and the publish path so preview output is byte-identical to published
 * output — do not fork this.
 *
 * rehypeSanitize is mandatory and non-negotiable: we store HTML and render it
 * with dangerouslySetInnerHTML, so skipping it is a stored-XSS hole.
 */

// The default sanitize schema allows `className` on <code> but with an empty
// allowlist, and none on <span> — which silently strips every class
// rehypeHighlight adds. Permit exactly the highlight classes and nothing else.
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./, "hljs"],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", /^hljs-./],
    ],
    pre: [...(defaultSchema.attributes?.pre ?? []), ["className", "hljs"]],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize, schema)
  .use(rehypeHighlight, { detect: false, ignoreMissing: true })
  .use(rehypeStringify);

/** Render Markdown to sanitized HTML. */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}

/** Reading time in minutes: wordCount / 265, minimum 1 (PRD §6.3). */
export function readingTime(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 265));
}

/** First ~140 chars of body text, for cards and meta tags (PRD §4.2). */
export function excerpt(markdown: string, length = 140): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/<[^>]*>/g, " ") // html tags — description is rendered as text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/[#>*_~-]/g, " ") // markdown punctuation
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= length) return plain;
  return plain.slice(0, length).trimEnd() + "…";
}
