import "server-only";

/**
 * Operator details used on the legal pages. Production builds refuse to render the legal
 * pages with missing values, so placeholder legal text can never ship.
 */
function read(name: string, devFallback: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set in production (used on /privacy and /terms). See .env.example.`);
  }
  return devFallback;
}

export const site = {
  get legalName() {
    return read("LEGAL_ENTITY_NAME", "[LEGAL_ENTITY_NAME]");
  },
  get contactEmail() {
    return read("CONTACT_EMAIL", "[CONTACT_EMAIL]");
  },
  get governingLaw() {
    return read("GOVERNING_LAW", "[GOVERNING_LAW]");
  },
  /** ISO date the current policies took effect. */
  get policyDate() {
    return read("POLICY_EFFECTIVE_DATE", "2026-10-03");
  },
};
