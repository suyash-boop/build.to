import { auth } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * Server-side session accessor for Server Components and route handlers.
 * Returns the BetterAuth session (with our extended user fields) or null.
 */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
