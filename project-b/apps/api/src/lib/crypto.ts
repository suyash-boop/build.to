import { createHash, randomBytes } from "node:crypto";

// Shared with the worker, which decrypts webhook signing secrets.
export { Encrypter } from "@bldt/core";

/** 160 bits of entropy, URL-safe. Used for session and invitation tokens. */
export function generateToken(): string {
  return randomBytes(20).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
