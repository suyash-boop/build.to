import { cn } from "@/lib/utils";
import type { GithubRepo } from "@/lib/github";

// A small set of common language colours (mirrors GitHub's dots).
const languageColors: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Ruby: "#701516",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  PHP: "#4F5D95",
  Vue: "#41b883",
};

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
    </svg>
  );
}

export interface RepoCardProps {
  repo: GithubRepo;
  /** Selection mode: shows a checkbox affordance and calls onToggle. */
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}

export function RepoCard({
  repo,
  selectable = false,
  selected = false,
  onToggle,
}: RepoCardProps) {
  const langColor = repo.language
    ? (languageColors[repo.language] ?? "#8a8a8a")
    : null;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="truncate font-semibold text-body">{repo.name}</span>
        {selectable && (
          <span
            aria-hidden
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded border",
              selected
                ? "border-brand bg-brand text-white"
                : "border-border",
            )}
          >
            {selected && (
              <svg viewBox="0 0 16 16" fill="currentColor" className="size-3">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z" />
              </svg>
            )}
          </span>
        )}
      </div>

      {repo.description && (
        <p className="mt-1 line-clamp-2 text-s text-secondary">
          {repo.description}
        </p>
      )}

      <div className="mt-3 flex items-center gap-4 text-s text-secondary">
        {repo.language && (
          <span className="flex items-center gap-1.5">
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: langColor ?? undefined }}
            />
            {repo.language}
          </span>
        )}
        {repo.stars > 0 && (
          <span className="flex items-center gap-1">
            <StarIcon />
            {repo.stars}
          </span>
        )}
      </div>
    </>
  );

  const base =
    "block rounded-large border bg-body-bg p-4 text-left transition-colors";

  if (selectable) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className={cn(
          base,
          "w-full",
          selected
            ? "border-brand ring-1 ring-brand"
            : "border-border hover:bg-base-bg",
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <a
      href={repo.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(base, "border-border hover:shadow-md")}
    >
      {inner}
    </a>
  );
}
