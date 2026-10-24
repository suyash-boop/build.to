import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize, keyRing, signClaims, verifySigned, type WorkRecordClaims } from "./work-records.ts";

function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    raw: (publicKey.export({ format: "jwk" }) as { x: string }).x,
  };
}

const claims = (): WorkRecordClaims => ({
  v: 1,
  id: "wr_1",
  issuer: "https://bld.test",
  issuedAt: "2026-10-03T00:00:00.000Z",
  subject: { username: "maya", name: "Maya Chen", github: "maya-gh" },
  project: { name: "Relay", url: "https://bld.test/maya/relay", visibility: "PUBLIC" },
  role: "OWNER",
  memberSince: "2026-07-01",
  period: { from: "2026-07-01", to: "2026-10-03" },
  summary: { tasksCompleted: 3, pullRequestsMerged: 2, additions: 120, deletions: 8, reviews: 1, releases: 1 },
  sources: { pullRequests: "github", reviews: "github", tasks: "bldt", releases: "bldt" },
  evidence: [{ kind: "pull_request", repo: "maya/relay", number: 12, title: "Bucket \"refill\" ü", url: "https://github.com/maya/relay/pull/12", mergedAt: "2026-09-01T00:00:00.000Z", additions: 120, deletions: 8 }],
  tasks: [],
});

describe("canonicalize", () => {
  it("sorts keys at every depth, drops undefined, and has no whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: [3, { z: null, y: true }], c: "x" }, u: undefined })).toBe('{"a":{"c":"x","d":[3,{"y":true,"z":null}]},"b":1}');
  });

  it("is independent of key order and rejects non-integers", () => {
    expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }));
    expect(() => canonicalize({ n: 1.5 })).toThrow(/integers/);
    expect(() => canonicalize({ n: Number.MAX_SAFE_INTEGER + 2 })).toThrow();
  });
});

describe("signing and verification", () => {
  it("verifies what it signs, even after a JSON round trip with reordered keys", () => {
    const k = newKey();
    const ring = keyRing(k.pkcs8);
    const { signed } = signClaims(claims(), ring.current);
    expect(signed.signature).toMatchObject({ alg: "Ed25519", kid: ring.current.kid });
    const shuffled = JSON.parse(JSON.stringify({ signature: signed.signature, record: Object.fromEntries(Object.entries(signed.record).reverse()) }));
    expect(verifySigned(shuffled, ring.byKid)).toMatchObject({ valid: true });
  });

  it("rejects any edit to the record", () => {
    const ring = keyRing(newKey().pkcs8);
    const { signed } = signClaims(claims(), ring.current);
    const edits: ((r: WorkRecordClaims) => void)[] = [
      (r) => void (r.summary.pullRequestsMerged = 20),
      (r) => void (r.role = "MAINTAINER"),
      (r) => void (r.evidence[0]!.title += " "),
      (r) => void r.tasks.push({ identifier: "RELAY-9", title: "Extra", completedAt: "2026-09-01T00:00:00.000Z" }),
    ];
    for (const edit of edits) {
      const copy = structuredClone(signed);
      edit(copy.record);
      expect(verifySigned(copy, ring.byKid)).toEqual({ valid: false, reason: "bad_signature" });
    }
  });

  it("rejects unknown keys and malformed documents", () => {
    const ring = keyRing(newKey().pkcs8);
    const other = keyRing(newKey().pkcs8);
    const { signed } = signClaims(claims(), other.current);
    expect(verifySigned(signed, ring.byKid)).toEqual({ valid: false, reason: "unknown_key" });
    for (const bad of [null, {}, { record: claims() }, { record: claims(), signature: { alg: "RS256", kid: "x", value: "y" } }, { record: { n: 1.5 }, signature: { ...signed.signature, kid: ring.current.kid } }]) {
      expect(verifySigned(bad, ring.byKid)).toMatchObject({ valid: false, reason: "malformed" });
    }
  });

  it("keeps verifying records signed by a retired key after rotation", () => {
    const oldKey = newKey();
    const before = keyRing(oldKey.pkcs8);
    const { signed } = signClaims(claims(), before.current);
    const after = keyRing(newKey().pkcs8, [oldKey.raw]);
    expect(after.current.kid).not.toBe(before.current.kid);
    expect(verifySigned(signed, after.byKid)).toMatchObject({ valid: true, kid: before.current.kid });
    expect(after.jwks.keys.map((k) => k.kid)).toEqual([after.current.kid, before.current.kid]);
    expect(after.jwks.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" });
  });

  it("rejects a key that is not Ed25519", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(() => keyRing(privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"))).toThrow(/Ed25519/);
  });
});
