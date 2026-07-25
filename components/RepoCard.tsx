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

function ForkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
      <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
    </svg>
  );
}

function RepoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
      <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.06-1.06l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z" />
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
      {/* Language-coloured accent along the top edge. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 rounded-t-large"
        style={{ backgroundColor: langColor ?? "var(--border-color)" }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <RepoIcon className="size-4 shrink-0 text-secondary" />
          <span className="truncate font-semibold text-body group-hover:text-brand">
            {repo.name}
          </span>
        </div>

        {selectable ? (
          <span
            aria-hidden
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
              selected
                ? "border-brand bg-brand text-white"
                : "border-border text-transparent",
            )}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="size-3">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z" />
            </svg>
          </span>
        ) : (
          <span className="shrink-0 text-secondary opacity-0 transition-opacity group-hover:opacity-100">
            <ExternalIcon />
          </span>
        )}
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2.5em] text-s text-secondary">
        {repo.description ?? "No description."}
      </p>

      <div className="mt-3 flex items-center gap-4 text-s text-secondary">
        {repo.language && (
          <span className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full ring-1 ring-inset ring-black/10"
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
        {repo.forks > 0 && (
          <span className="flex items-center gap-1">
            <ForkIcon />
            {repo.forks}
          </span>
        )}
      </div>
    </>
  );

  const base =
    "group relative block overflow-hidden rounded-large border bg-body-bg p-4 pt-5 text-left transition-all";

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
            : "border-border hover:border-secondary",
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
      className={cn(
        base,
        "border-border hover:-translate-y-0.5 hover:border-secondary hover:shadow-md",
      )}
    >
      {inner}
    </a>
  );
}
