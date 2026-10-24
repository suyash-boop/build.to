import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify the X-Hub-Signature-256 header against the raw request body. Constant time. */
export function verifyWebhookSignature(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Webhook events the worker handles. Anything else is recorded and ignored. */
export const HANDLED_EVENTS = new Set([
  "installation",
  "installation_repositories",
  "repository",
  "push",
  "pull_request",
  "pull_request_review",
  "issues",
  "release",
  "deployment",
  "deployment_status",
  "ping",
]);
