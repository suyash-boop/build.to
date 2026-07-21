"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { revalidatePath } from "next/cache";

/** Unread notification count for the header bell badge. */
export async function getUnreadCount(): Promise<number> {
  const session = await getSession();
  if (!session) return 0;
  return prisma.notification.count({
    where: { userId: session.user.id, read: false },
  });
}

/** Mark all of the current user's notifications read (on viewing the page). */
export async function markAllRead(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await prisma.notification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true },
  });
  revalidatePath("/notifications");
}
