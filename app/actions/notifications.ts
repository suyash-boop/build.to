"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { revalidatePath } from "next/cache";

/** Unread notification count for the header bell badge. */
export async function getUnreadCount(): Promise<number> {
  const session = await getSession();
  if (!session) return 0;
  const [community, workspace] = await Promise.all([
    prisma.notification.count({ where: { userId: session.user.id, read: false } }),
    prisma.projectNotification.count({ where: { recipientId: session.user.id, readAt: null } }),
  ]);
  return community + workspace;
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
