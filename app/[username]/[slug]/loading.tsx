import { Card, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Card className="p-6 sm:p-10">
        <Skeleton className="h-9 w-4/5" />
        <div className="mt-4 flex items-center gap-3">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Card>
    </main>
  );
}
