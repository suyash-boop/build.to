import "server-only";
import type { Me } from "@bldt/contracts";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { trustedClientIp } from "./client-ip";

const API = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";

export class ServerApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Server-side API call forwarding the user's session cookie. Never cached: responses are per-user. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const jar = await cookies();
  const h = await headers();
  const ip = trustedClientIp((n) => h.get(n));
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    // A hung API must not hold the page render open indefinitely.
    signal: init.signal ?? AbortSignal.timeout(10_000),
    headers: {
      ...(init.headers ?? {}),
      cookie: jar.toString(),
      "user-agent": h.get("user-agent") ?? "bldt-web",
      // Server-rendered calls carry the visitor IP too, so per-IP limits are per visitor.
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
  });
  if (!res.ok) {
    let code = "error";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* non-JSON error */
    }
    throw new ServerApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

/** Like api(), but turns 404 into the Next.js not-found page. */
export async function apiOr404<T>(path: string): Promise<T> {
  try {
    return await api<T>(path);
  } catch (err) {
    if (err instanceof ServerApiError && err.status === 404) notFound();
    throw err;
  }
}

/** The signed-in user, or null. Deduplicated per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  const jar = await cookies();
  if (!jar.getAll().some((c) => c.name.includes("better-auth."))) return null;
  try {
    return await api<Me>("/me");
  } catch (err) {
    if (err instanceof ServerApiError && err.status === 401) return null;
    throw err;
  }
});

export async function requireMe(next: string): Promise<Me> {
  const me = await getMe();
  if (!me) redirect(`${process.env.WEB_ORIGIN || "http://localhost:3000"}/login?redirect=${encodeURIComponent(`/projects${next}`)}`);
  return me;
}
