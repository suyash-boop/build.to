import { Card, Skeleton } from "@/components/ui";

/** Placeholder matching PostCard's shape, shown while the feed loads. */
export function PostCardSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
      <Skeleton className="mt-3 h-6 w-3/4" />
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-6 w-16 rounded" />
        <Skeleton className="h-6 w-16 rounded" />
        <Skeleton className="h-6 w-16 rounded" />
      </div>
      <Skeleton className="mt-3 h-3 w-40" />
    </Card>
  );
}

export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <PostCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
