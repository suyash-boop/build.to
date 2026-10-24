/** Upstream integration fixtures truncate tables. Never infer their target. */
export function requireLocalTestDatabase(value: string | undefined, variable: string): string {
  if (!value) throw new Error(`${variable} must explicitly name an isolated local test database. Use the root merged integration suite for shared-auth checks.`);
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.includes("_test")) {
    throw new Error(`${variable} must point to a local database whose name contains _test. Refusing destructive legacy fixtures.`);
  }
  return value;
}
