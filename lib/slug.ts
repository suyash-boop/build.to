/**
 * Slug generation (PRD §5.2). Derived from the title plus a short random
 * suffix, which keeps slugs unique without a collision-retry loop. A slug is
 * immutable once the post is first published.
 */
export function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}
