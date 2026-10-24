import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import type { SignedWorkRecord, WorkRecordClaims } from "@bldt/contracts";
import type { Db } from "@bldt/db";

export type { SignedWorkRecord, WorkRecordClaims, WorkRecordEvidence, WorkRecordTask } from "@bldt/contracts";

/**
 * Verifiable work records. A record states what one person did on one project over a period, built
 * only from evidence bld.t observed itself (GitHub data tied to the person's linked account, and
 * work tracked in bld.t). It is serialised as canonical JSON and signed with Ed25519, so anyone can
 * check it against the published key without trusting this server, and any edit breaks it.
 */

export const WORK_RECORD_VERSION = 1;
export const MAX_EVIDENCE = 50;

/** RFC 8785 style canonical JSON for the value types records use: objects (sorted keys), arrays, strings, integers, booleans, null. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Canonical records only contain safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`Cannot canonicalize ${typeof value}`);
}

// ── Keys ─────────────────────────────────────────────────────

export interface PublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  alg: "EdDSA";
  use: "sig";
}

export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  jwk: PublicJwk;
}

function rawPublic(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url");
}

/** Key id: a short fingerprint of the public key, so ids cannot be confused or reused. */
export function keyId(publicKey: KeyObject): string {
  return createHash("sha256").update(rawPublic(publicKey)).digest("base64url").slice(0, 16);
}

function toJwk(publicKey: KeyObject): PublicJwk {
  return { kty: "OKP", crv: "Ed25519", x: rawPublic(publicKey).toString("base64url"), kid: keyId(publicKey), alg: "EdDSA", use: "sig" };
}

/** WORK_RECORD_SIGNING_KEY: base64 of a PKCS#8 DER Ed25519 private key (one line, env-friendly). */
export function loadSigningKey(base64Pkcs8: string): SigningKey {
  const privateKey = createPrivateKey({ key: Buffer.from(base64Pkcs8, "base64"), format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("WORK_RECORD_SIGNING_KEY must be an Ed25519 key");
  const publicKey = createPublicKey(privateKey);
  return { kid: keyId(publicKey), privateKey, publicKey, jwk: toJwk(publicKey) };
}

/** Retired keys stay published (as raw base64url public keys) so records they signed still verify. */
export function loadPublicKey(rawBase64url: string): { kid: string; publicKey: KeyObject; jwk: PublicJwk } {
  const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: rawBase64url }, format: "jwk" });
  return { kid: keyId(publicKey), publicKey, jwk: toJwk(publicKey) };
}

export interface KeyRing {
  current: SigningKey;
  byKid: Map<string, KeyObject>;
  jwks: { keys: PublicJwk[] };
}

export function keyRing(signingKey: string, retired: string[] = []): KeyRing {
  const current = loadSigningKey(signingKey);
  const old = retired.filter(Boolean).map(loadPublicKey);
  const byKid = new Map<string, KeyObject>([[current.kid, current.publicKey], ...old.map((k) => [k.kid, k.publicKey] as [string, KeyObject])]);
  return { current, byKid, jwks: { keys: [current.jwk, ...old.map((k) => k.jwk)] } };
}

// ── Records ──────────────────────────────────────────────────

export function signClaims(claims: WorkRecordClaims, key: SigningKey): { canonical: string; signed: SignedWorkRecord } {
  const canonical = canonicalize(claims);
  const value = sign(null, Buffer.from(canonical, "utf8"), key.privateKey).toString("base64url");
  return { canonical, signed: { record: claims, signature: { alg: "Ed25519", kid: key.kid, value } } };
}

export type VerifyFailure = "malformed" | "unknown_key" | "bad_signature";

/** Verify a signed record as a third party would: canonicalize what was received and check it. */
export function verifySigned(doc: unknown, byKid: Map<string, KeyObject>): { valid: true; canonical: string; kid: string } | { valid: false; reason: VerifyFailure } {
  const d = doc as Partial<SignedWorkRecord> | null;
  const sig = d?.signature;
  if (!d || typeof d !== "object" || !d.record || typeof d.record !== "object" || !sig || sig.alg !== "Ed25519" || typeof sig.kid !== "string" || typeof sig.value !== "string") {
    return { valid: false, reason: "malformed" };
  }
  const key = byKid.get(sig.kid);
  if (!key) return { valid: false, reason: "unknown_key" };
  let canonical: string;
  try {
    canonical = canonicalize(d.record);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  const ok = verify(null, Buffer.from(canonical, "utf8"), key, Buffer.from(sig.value, "base64url"));
  return ok ? { valid: true, canonical, kid: sig.kid } : { valid: false, reason: "bad_signature" };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Gather the claims for one member of one project. Pull requests count only when GitHub says the
 * person's linked account (by numeric id, which survives renames) authored them and they merged.
 */
export async function buildClaims(
  db: Db,
  input: { recordId: string; userId: string; projectId: string; from: Date; to: Date; issuer: string; now?: Date },
): Promise<WorkRecordClaims> {
  const now = input.now ?? new Date();
  const [user, member, project] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: input.userId }, select: { username: true, displayName: true, githubAccount: { select: { githubUserId: true, login: true } } } }),
    db.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: input.projectId, userId: input.userId } }, select: { role: true, joinedAt: true } }),
    db.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { name: true, slug: true, key: true, visibility: true, owner: { select: { username: true } }, repositories: { select: { repositoryId: true } } } }),
  ]);
  const range = { gte: input.from, lte: input.to };
  const repoIds = project.repositories.map((r) => r.repositoryId);
  const gh = user.githubAccount;

  const [prs, tasks, reviews, releases] = await Promise.all([
    gh && repoIds.length
      ? db.pullRequest.findMany({
          where: { repositoryId: { in: repoIds }, authorGithubId: gh.githubUserId, state: "MERGED", mergedAt: range },
          select: { number: true, title: true, htmlUrl: true, mergedAt: true, additions: true, deletions: true, repository: { select: { fullName: true } } },
          orderBy: { mergedAt: "desc" },
        })
      : [],
    db.task.findMany({
      where: { projectId: input.projectId, assigneeId: input.userId, status: "DONE", completedAt: range },
      select: { number: true, title: true, completedAt: true },
      orderBy: { completedAt: "desc" },
    }),
    db.activityEvent.count({ where: { projectId: input.projectId, type: "github.review", actorId: input.userId, trust: "CONNECTED", occurredAt: range } }),
    db.release.count({ where: { projectId: input.projectId, createdById: input.userId, shippedAt: range } }),
  ]);

  const redacted = project.visibility === "PRIVATE";
  return {
    v: WORK_RECORD_VERSION,
    id: input.recordId,
    issuer: input.issuer,
    issuedAt: now.toISOString(),
    subject: { username: user.username, name: user.displayName, github: gh?.login ?? null },
    project: {
      name: redacted ? null : project.name,
      url: redacted ? null : `${input.issuer}/${project.owner.username}/${project.slug}`,
      visibility: project.visibility,
    },
    role: member.role,
    memberSince: day(member.joinedAt),
    period: { from: day(input.from), to: day(input.to) },
    summary: {
      tasksCompleted: tasks.length,
      pullRequestsMerged: prs.length,
      additions: prs.reduce((a, p) => a + p.additions, 0),
      deletions: prs.reduce((a, p) => a + p.deletions, 0),
      reviews,
      releases,
    },
    sources: { pullRequests: "github", reviews: "github", tasks: "bldt", releases: "bldt" },
    evidence: redacted
      ? []
      : prs.slice(0, MAX_EVIDENCE).map((p) => ({
          kind: "pull_request" as const,
          repo: p.repository.fullName,
          number: p.number,
          title: p.title,
          url: p.htmlUrl,
          mergedAt: p.mergedAt!.toISOString(),
          additions: p.additions,
          deletions: p.deletions,
        })),
    tasks: redacted ? [] : tasks.slice(0, MAX_EVIDENCE).map((t) => ({ identifier: `${project.key}-${t.number}`, title: t.title, completedAt: t.completedAt!.toISOString() })),
  };
}
