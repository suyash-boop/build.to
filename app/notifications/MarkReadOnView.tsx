"use client";

import { useEffect } from "react";
import { markAllRead } from "@/app/actions/notifications";

/**
 * Marks notifications read after the page mounts. Doing this in a client effect
 * keeps the revalidatePath inside markAllRead out of the server render, which
 * Next.js forbids — and it means the list renders with its unread styling
 * before being cleared.
 */
export function MarkReadOnView() {
  useEffect(() => {
    void markAllRead();
  }, []);
  return null;
}
