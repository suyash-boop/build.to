import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4">
      <EmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist or may have moved."
        action={
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded bg-brand px-4 text-s font-medium text-white transition-colors hover:bg-brand-hover"
          >
            Back to the feed
          </Link>
        }
      />
    </main>
  );
}
