// Reserved usernames (PRD §4.1). These cannot be registered because /[username]
// sits at the application root and would otherwise shadow real routes.
export const RESERVED_USERNAMES = new Set([
  "new",
  "settings",
  "search",
  "api",
  "t",
  "login",
  "signup",
  "admin",
  "dashboard",
  "about",
  "terms",
  "privacy",
  // Also reserve routes we use even though they aren't in the PRD list:
  "onboarding",
  "notifications",
]);

// PRD §5.1: ^[a-z0-9_]{3,20}$
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export type UsernameError =
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "reserved";

/** Returns null if valid, otherwise a machine-readable error code. */
export function validateUsername(username: string): UsernameError | null {
  if (username.length < 3) return "too_short";
  if (username.length > 20) return "too_long";
  if (!USERNAME_PATTERN.test(username)) return "invalid_chars";
  if (RESERVED_USERNAMES.has(username)) return "reserved";
  return null;
}

export const USERNAME_ERROR_MESSAGES: Record<UsernameError, string> = {
  too_short: "Username must be at least 3 characters.",
  too_long: "Username must be 20 characters or fewer.",
  invalid_chars: "Use only lowercase letters, numbers, and underscores.",
  reserved: "That username is reserved. Pick another.",
};
