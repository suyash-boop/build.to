import { Skeleton } from "@/components/ui/misc";

/**
 * Route-level loading states. Each mirrors the real page's geometry so content swaps in
 * without the layout jumping. Shown instantly on navigation, before any data arrives.
 */

function Bar() {
  return (
    <div className="sticky top-0 z-20 hidden h-12 items-center border-b border-border px-5 md:flex in-[.public-shell]:md:hidden">
      <Skeleton className="h-3.5 w-24" />
    </div>
  );
}

function Rows({ n = 5, className = "h-10" }: { n?: number; className?: string }) {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-surface">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={`flex items-center gap-3 px-3 ${className}`}>
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className={`h-3 ${["w-1/2", "w-2/3", "w-2/5", "w-3/5", "w-1/3"][i % 5]}`} />
        </div>
      ))}
    </div>
  );
}

function Cards({ n = 4, cols = "sm:grid-cols-2" }: { n?: number; cols?: string }) {
  return (
    <div className={`grid gap-3 ${cols}`}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="mt-2 h-3 w-1/4" />
          <Skeleton className="mt-4 h-3 w-5/6" />
          <div className="mt-4 flex gap-1.5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-5 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Label() {
  return <Skeleton className="mb-3 h-2.5 w-24" />;
}

export function HomeSkeleton() {
  return (
    <>
      <Bar />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-8">
            <div>
              <Label />
              <Rows n={4} />
            </div>
            <div>
              <Label />
              <Cards n={2} />
            </div>
          </div>
          <div>
            <Label />
            <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-5 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Whole project page (header + content), used when entering a project from elsewhere. */
export function ProjectSkeleton() {
  return (
    <div>
      <div className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 md:px-6 md:pt-5">
          <Skeleton className="h-2.5 w-24" />
          <div className="mt-2 flex items-center gap-2.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="mt-2.5 h-3 w-80 max-w-full" />
          <div className="mt-5 flex gap-5 pb-3">
            {[60, 40, 70, 54, 58, 48].map((w, i) => (
              <Skeleton key={i} className="h-3" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>
      <ProjectContentSkeleton />
    </div>
  );
}

/** Content area under the project header, for switching tabs. */
export function ProjectContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Skeleton className="h-20 w-full rounded-lg" />
          <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="ml-auto h-8 w-56" />
      </div>
      <div className="flex gap-3 overflow-hidden px-4 py-4 md:px-6">
        {[3, 2, 1, 1, 2].map((n, c) => (
          <div key={c} className="w-[256px] shrink-0">
            <Skeleton className="mb-3 h-3.5 w-24" />
            <div className="space-y-1.5">
              {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="rounded-md border border-border bg-surface px-3 py-2.5">
                  <Skeleton className="h-2.5 w-14" />
                  <Skeleton className="mt-2 h-3 w-5/6" />
                  <Skeleton className="mt-3 h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListPageSkeleton({ width = "max-w-4xl" }: { width?: string }) {
  return (
    <>
      <Bar />
      <div className={`mx-auto w-full ${width} px-4 py-5 md:px-6 md:py-6`}>
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-7 w-28" />
        </div>
        <Rows n={7} className="h-12" />
      </div>
    </>
  );
}

export function GridPageSkeleton() {
  return (
    <>
      <Bar />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">
        <div className="mb-6 flex gap-5 border-b border-border pb-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
        </div>
        <Skeleton className="mb-5 h-8 w-72" />
        <Cards n={6} cols="sm:grid-cols-2 xl:grid-cols-3" />
      </div>
    </>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">
      <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div>
          <Skeleton className="size-[72px] rounded-full" />
          <Skeleton className="mt-4 h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-24" />
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
        <div className="space-y-8">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Cards n={2} cols="" />
        </div>
      </div>
    </div>
  );
}

export function FormPageSkeleton() {
  return (
    <>
      <Bar />
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-5 md:px-6 md:py-6">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Skeleton className="mb-3 h-3.5 w-32" />
            <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
