"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  USERNAME_ERROR_MESSAGES,
  validateUsername,
} from "@/lib/username";
import { redirect } from "next/navigation";

export type ClaimUsernameState = { error: string } | null;

/**
 * Claim a username for the current user (first-run onboarding). Validates format
 * and the reserved list, then checks DB uniqueness at submit time (PRD §5.1).
 */
export async function claimUsername(
  _prev: ClaimUsernameState,
  formData: FormData,
): Promise<ClaimUsernameState> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (session.user.username) return { error: "Your username is already set and is shared with your articles and projects." };

  const raw = String(formData.get("username") ?? "").trim().toLowerCase();

  const validationError = validateUsername(raw);
  if (validationError) {
    return { error: USERNAME_ERROR_MESSAGES[validationError] };
  }

  const existing = await prisma.user.findUnique({ where: { username: raw } });
  if (existing && existing.id !== session.user.id) {
    return { error: "That username is taken. Pick another." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { username: raw },
  });

  const candidate = String(formData.get("redirect") ?? "/");
  redirect(candidate.startsWith("/") && !candidate.startsWith("//") && !/[\\\r\n]/.test(candidate) ? candidate : "/");
}
