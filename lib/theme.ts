import { cookies } from "next/headers";

export type Theme = "light" | "dark";

export const THEME_COOKIE = "theme";

/**
 * Read the theme from the cookie for the server render (PRD §8.3). Because the
 * server knows the theme, <html data-theme> is correct on first paint and there
 * is no flash of the wrong theme.
 */
export async function getTheme(): Promise<Theme> {
  const cookieStore = await cookies();
  return cookieStore.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
}
