import { FeedSkeleton } from "@/components/post/PostCardSkeleton";

// Shown while the home feed's data resolves. Mirrors the three-column layout.
export default function Loading() {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[200px_1fr_260px] md:grid-cols-[1fr_260px]">
      <aside className="hidden lg:block" />
      <main className="min-w-0">
        <div className="mb-4 h-6 w-20 animate-pulse rounded bg-base-bg" />
        <FeedSkeleton />
      </main>
      <aside className="hidden md:block" />
    </div>
  );
}
