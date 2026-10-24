import { describe, expect, it } from "vitest";
import { DnsLookupError, isPublicAddress, UnsafeUrlError, vetWebhookUrl } from "./net-guard.ts";
import { activityEnvelope, formatBody, signalEnvelope, signWebhook, verifyWebhookSignature, type WebhookEnvelope } from "./outbound.ts";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "2002:c0a8:101::1",
    "::a00:1",
    "::ffff:0:a00:1",
    "64:ff9b:1::a00:1",
    "fec0::1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["1.1.1.1", "140.82.112.3", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("vetWebhookUrl", () => {
  const resolveTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("accepts a public https host and returns the address to pin", async () => {
    const t = await vetWebhookUrl("https://hooks.example.com/x#frag", { resolve: resolveTo("93.184.216.34") });
    expect(t.address).toBe("93.184.216.34");
    expect(t.url.href).toBe("https://hooks.example.com/x");
  });

  it.each([
    ["http://hooks.example.com/x", "https"],
    ["https://user:pw@hooks.example.com/", "credentials"],
    ["ftp://x.com", "https"],
    ["not a url", "full URL"],
    ["https://hooks.example.com:22/x", "standard https port"],
    ["https://hooks.example.com:6379/x", "standard https port"],
  ])("rejects %s", async (url, msg) => {
    await expect(vetWebhookUrl(url, { resolve: resolveTo("93.184.216.34") })).rejects.toThrow(new RegExp(msg, "i"));
  });

  it("rejects hosts that resolve to any private address, including literals and mixed answers", async () => {
    await expect(vetWebhookUrl("https://127.0.0.1/hook")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(vetWebhookUrl("https://[::1]/hook")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(vetWebhookUrl("https://evil.example/", { resolve: resolveTo("93.184.216.34", "10.0.0.5") })).rejects.toThrow(/private/);
    await expect(vetWebhookUrl("https://nowhere.example/", { resolve: async () => [] })).rejects.toThrow(/resolve/);
  });

  it("treats resolver failures as temporary, not as an unsafe URL", async () => {
    const failing = async () => {
      throw Object.assign(new Error("queryA ESERVFAIL"), { code: "ESERVFAIL" });
    };
    await expect(vetWebhookUrl("https://hooks.example.com/", { resolve: failing })).rejects.toBeInstanceOf(DnsLookupError);
    await expect(vetWebhookUrl("https://hooks.example.com/", { resolve: async () => [] })).rejects.toBeInstanceOf(DnsLookupError);
  });

  it("accepts 8443 and the default ports", async () => {
    await expect(vetWebhookUrl("https://hooks.example.com:8443/x", { resolve: resolveTo("93.184.216.34") })).resolves.toMatchObject({ address: "93.184.216.34" });
    await expect(vetWebhookUrl("https://hooks.example.com:443/x", { resolve: resolveTo("93.184.216.34") })).resolves.toBeTruthy();
  });

  it("allows local receivers only when explicitly enabled for development", async () => {
    const t = await vetWebhookUrl("http://localhost:9000/in", { allowPrivate: true, resolve: resolveTo("127.0.0.1") });
    expect(t.address).toBe("127.0.0.1");
  });
});

describe("signatures", () => {
  it("verifies its own signature and rejects tampering, wrong secrets and stale timestamps", () => {
    const body = JSON.stringify({ hello: "world" });
    const header = signWebhook("whsec_a", body, 1_700_000_000);
    expect(verifyWebhookSignature("whsec_a", body, header, 300, 1_700_000_100)).toBe(true);
    expect(verifyWebhookSignature("whsec_a", body + " ", header, 300, 1_700_000_100)).toBe(false);
    expect(verifyWebhookSignature("whsec_b", body, header, 300, 1_700_000_100)).toBe(false);
    expect(verifyWebhookSignature("whsec_a", body, header, 300, 1_700_001_000)).toBe(false);
  });
});

describe("envelopes and chat formats", () => {
  const project = { id: "p1", name: "Relay & <Co>", slug: "relay", owner: "maya", url: "https://bld.to/maya/relay" };
  const actor = { username: "maya", name: "Maya Chen", githubLogin: null };

  it("maps internal activity to the public contract with a useful link", () => {
    const e = activityEnvelope({ id: "a1", type: "task.completed", payload: { identifier: "RELAY-3", title: "CI matrix" }, occurredAt: new Date("2026-10-01T00:00:00Z"), project, actor })!;
    expect(e).toMatchObject({ id: "evt_a1", type: "task.completed", url: "https://bld.to/maya/relay/tasks?task=3" });
    const pr = activityEnvelope({ id: "a2", type: "github.pr_merged", payload: { number: 12, title: "Bucket", url: "https://github.com/maya/relay/pull/12" }, occurredAt: new Date(), project, actor })!;
    expect(pr).toMatchObject({ type: "pull_request.merged", url: "https://github.com/maya/relay/pull/12" });
    expect(activityEnvelope({ id: "a3", type: "project.created", payload: {}, occurredAt: new Date(), project, actor })).toBeNull();
  });

  it("escapes Slack control characters and keeps links intact", () => {
    const e: WebhookEnvelope = { id: "x", type: "task.created", createdAt: new Date().toISOString(), project, actor, url: "https://bld.to/maya/relay/tasks?task=9", data: { identifier: "RELAY-9", title: "Fix <script> & a|b" } };
    const { text } = JSON.parse(formatBody("SLACK", e));
    expect(text).toBe("*Relay &amp; &lt;Co&gt;* · Maya Chen created <https://bld.to/maya/relay/tasks?task=9|RELAY-9 Fix &lt;script&gt; &amp; a¦b>");
  });

  it("never lets Discord messages mention anyone", () => {
    const e: WebhookEnvelope = { id: "x", type: "task.created", createdAt: new Date().toISOString(), project, actor: { username: "x", name: "@everyone", githubLogin: null }, url: null, data: { identifier: "R-1", title: "@here hi" } };
    const body = JSON.parse(formatBody("DISCORD", e));
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].title).toBe("R-1 @here hi");
  });

  it("gives escalated signals a new event id but keeps one id per occurrence", () => {
    const base = { id: "s1", signalType: "task.stalled", severity: "WARNING", title: "RELAY-1 has not moved in 6 days", data: { number: 1 }, project };
    const a = signalEnvelope({ ...base, notifiedAt: new Date(1000) });
    const b = signalEnvelope({ ...base, notifiedAt: new Date(1000) });
    const c = signalEnvelope({ ...base, severity: "CRITICAL", notifiedAt: new Date(2000) });
    expect(a.id).toBe(b.id);
    expect(c.id).not.toBe(a.id);
    expect(a.url).toBe("https://bld.to/maya/relay/tasks?task=1");
  });
});
