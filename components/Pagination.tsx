import Link from "next/link";

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Base path, e.g. "/" or "/t/javascript". Page is appended as ?page=N. */
  basePath: string;
  /** Extra query params to preserve, e.g. a search term. */
  params?: Record<string, string>;
}

function buildHref(
  basePath: string,
  page: number,
  params?: Record<string, string>,
) {
  const search = new URLSearchParams(params);
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

const linkClasses =
  "inline-flex h-9 items-center justify-center rounded border border-border px-4 text-s font-medium text-body transition-colors hover:bg-base-bg";

export function Pagination({
  page,
  totalPages,
  basePath,
  params,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav
      className="mt-6 flex items-center justify-between gap-4"
      aria-label="Pagination"
    >
      {page > 1 ? (
        <Link href={buildHref(basePath, page - 1, params)} className={linkClasses}>
          Previous
        </Link>
      ) : (
        <span />
      )}

      <p className="text-s text-secondary">
        Page {page} of {totalPages}
      </p>

      {page < totalPages ? (
        <Link href={buildHref(basePath, page + 1, params)} className={linkClasses}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
