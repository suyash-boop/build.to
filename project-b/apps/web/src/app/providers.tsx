"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { LazyMotion, MotionConfig, domMax } from "motion/react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/overlay";
import { ApiError } from "@/lib/api.client";
import { duration, ease } from "@/lib/motion";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // Client errors will not fix themselves; retry only transient failures.
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {/* domMax adds layout animations (sliding indicators); "user" honours the OS reduced-motion setting. */}
      <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: duration.base, ease: ease.out }}>
      <TooltipProvider>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: "!bg-surface !text-fg !border !border-border !shadow-pop !rounded-lg !text-sm !font-sans",
          }}
        />
      </TooltipProvider>
      </MotionConfig>
      </LazyMotion>
    </QueryClientProvider>
  );
}
