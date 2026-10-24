import { z } from "zod";

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().default(4000),
    API_HOST: z.string().default("127.0.0.1"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    /** Public origin of the web app, e.g. https://bld.to. Used for redirects and Origin checks. */
    WEB_ORIGIN: z.url().default("http://localhost:3000"),
    AUTH_INTERNAL_URL: z.url().default("http://127.0.0.1:3000"),
    DATABASE_URL: z.string().min(1),
    /** Direct (non-pooled) connection for LISTEN. Falls back to DATABASE_URL, which must then be direct. */
    DIRECT_DATABASE_URL: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    /** Development only: allow webhook URLs on http and private addresses (a local receiver). */
    WEBHOOKS_ALLOW_PRIVATE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** Optional. Ed25519 private key, base64 PKCS#8 DER, for signing work records. Feature is off when unset. */
    WORK_RECORD_SIGNING_KEY: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    /** Comma-separated raw public keys (base64url) of retired signing keys, kept so old records verify. */
    WORK_RECORD_RETIRED_KEYS: z.string().trim().optional().transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [])),
    /** Live updates over server-sent events. */
    REALTIME: z.enum(["on", "off"]).default("on"),
    REDIS_URL: z.string().min(1),
    /** 32 bytes, base64. Encrypts stored GitHub tokens. Generate: openssl rand -base64 32 */
    ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "Must be 32 bytes, base64"),
    /** Signs short-lived cookies (OAuth state). */
    COOKIE_SECRET: z.string().min(32),
    GITHUB_APP_ID: z.string().default(""),
    GITHUB_APP_SLUG: z.string().default(""),
    GITHUB_APP_PRIVATE_KEY: z.string().default(""),
    GITHUB_APP_CLIENT_ID: z.string().default(""),
    GITHUB_APP_CLIENT_SECRET: z.string().default(""),
    GITHUB_WEBHOOK_SECRET: z.string().default(""),
    /** Optional. AI features (project briefs, release note drafts) are off when unset. */
    ANTHROPIC_API_KEY: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    /** Behind a load balancer/proxy, trust X-Forwarded-* for client IPs. */
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .refine((e) => !(e.NODE_ENV === "production" && e.WEBHOOKS_ALLOW_PRIVATE), { message: "must not be enabled in production", path: ["WEBHOOKS_ALLOW_PRIVATE"] })
  .transform((e) => ({ ...e, isProd: e.NODE_ENV === "production" }));

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${lines}\nSee .env.example.`);
  }
  return parsed.data;
}
