"use client";

export type ThemePref = "system" | "light" | "dark";

export function readTheme(): ThemePref {
  const v = document.documentElement.dataset.theme;
  return v === "light" || v === "dark" ? v : "system";
}

/** Persist in a cookie so the server renders the right theme on the next request (no flash). */
export function setTheme(pref: ThemePref) {
  const root = document.documentElement;
  const resolved = pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
  root.dataset.theme = resolved;
  document.cookie = `theme=${resolved}; path=/; max-age=31536000; samesite=lax`;
}
