import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Api, ApiError, pollForToken, type DeviceCode } from "../src/api.ts";
import { backoffDelay, openStream, READ_TIMEOUT_MS, SseParser } from "../src/sse.ts";

describe("SseParser", () => {
  it("parses events split across chunks, with CRLF, comments and multi-line data", () => {
    const p = new SseParser();
    expect(p.push("retry: 3000\nevent: rea")).toEqual([]);
    expect(p.push("dy\ndata: {}\n\n: ping\n\n")).toEqual([{ event: "ready", data: "{}" }]);
    expect(p.push('event: change\r\ndata: [{"k":"task"}]\r\n\r\ndata: a\ndata: b\n\n')).toEqual([
      { event: "change", data: '[{"k":"task"}]' },
      { event: "message", data: "a\nb" },
    ]);
  });
});

const enc = new TextEncoder();

/**
 * A fake /api/realtime response: sends `chunks`, then closes after `closeAfter` ms (never when
 * undefined), sending a ping every `pingEvery` ms meanwhile. Aborting the request errors the body,
 * as a real fetch does.
 */
function streamResponse(signal: AbortSignal | null | undefined, chunks: string[], opts: { closeAfter?: number; pingEvery?: number } = {}) {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        const timers: ReturnType<typeof setTimeout>[] = [];
        const end = (fn: () => void) => {
          timers.forEach((t) => clearTimeout(t));
          try {
            fn();
          } catch {
            /* already closed */
          }
        };
        if (opts.pingEvery) timers.push(setInterval(() => c.enqueue(enc.encode(": ping\n\n")), opts.pingEvery));
        if (opts.closeAfter === 0) end(() => c.close());
        else if (opts.closeAfter !== undefined) timers.push(setTimeout(() => end(() => c.close()), opts.closeAfter));
        signal?.addEventListener("abort", () => end(() => c.error(new Error("aborted"))));
      },
    }),
    { status: 200 },
  );
}

const READY = "event: ready\ndata: {}\n\n";

describe("backoffDelay", () => {
  it("doubles, caps at a minute, and adds up to 2 seconds of jitter", () => {
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, () => 0))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(10, () => 0)).toBe(60_000);
    expect(backoffDelay(0, () => 0.9999)).toBe(1000 + 1999);
  });
});

describe("openStream", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  function harness(respond: (call: number, signal: AbortSignal | null | undefined) => Response) {
    const calls: number[] = [];
    const events: string[] = [];
    const h = { calls, events, reconnects: 0, unauthorized: 0, stop: () => {} };
    h.stop = openStream({
      url: "http://x/api/realtime",
      headers: () => ({ authorization: "Bearer t" }),
      onEvent: (e) => events.push(e.data),
      onReconnect: () => void h.reconnects++,
      onUnauthorized: () => void h.unauthorized++,
      log: () => {},
      random: () => 0,
      fetchImpl: async (_url, init) => {
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer t");
        calls.push(Date.now());
        return respond(calls.length, init?.signal);
      },
    });
    return h;
  }

  it("delivers events, reconnects after the stream ends, and signals the reconnect", async () => {
    const start = Date.now();
    const h = harness((n, signal) => streamResponse(signal, [READY, `event: change\ndata: ${n}\n\n`], { closeAfter: n === 1 ? 0 : undefined }));
    await vi.advanceTimersByTimeAsync(1_000);
    h.stop();
    expect(h.events).toEqual(["1", "2"]);
    expect(h.reconnects).toBe(1);
    expect(h.calls.map((t) => t - start)).toEqual([0, 1000]);
  });

  it("keeps backing off while connections drop right after ready", async () => {
    const start = Date.now();
    const h = harness((_n, signal) => streamResponse(signal, [READY], { closeAfter: 0 }));
    await vi.advanceTimersByTimeAsync(7_000);
    h.stop();
    expect(h.calls.map((t) => t - start)).toEqual([0, 1000, 3000, 7000]);
  });

  it("resets the backoff only after a connection held for 30 seconds", async () => {
    const start = Date.now();
    // Drops at once, then holds 31s (with pings), then drops at once again.
    const h = harness((n, signal) => streamResponse(signal, [READY], n === 2 ? { closeAfter: 31_000, pingEvery: 25_000 } : { closeAfter: 0 }));
    await vi.advanceTimersByTimeAsync(1_000 + 31_000 + 1_000);
    h.stop();
    // Without the reset, the third attempt would wait 2 seconds (at 34s), not 1.
    expect(h.calls.map((t) => t - start)).toEqual([0, 1000, 33_000]);
  });

  it("reconnects when nothing arrives for 60 seconds", async () => {
    const start = Date.now();
    const h = harness((_n, signal) => streamResponse(signal, [READY]));
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    expect(h.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 1_000);
    h.stop();
    expect(h.calls.map((t) => t - start)).toEqual([0, READ_TIMEOUT_MS + 1000]);
  });

  it("stays connected while pings keep arriving", async () => {
    const h = harness((_n, signal) => streamResponse(signal, [READY], { pingEvery: 25_000 }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    h.stop();
    expect(h.calls).toHaveLength(1);
  });

  it("on 401, reports it and retries with backoff instead of giving up", async () => {
    const h = harness((n, signal) => (n === 1 ? new Response("", { status: 401 }) : streamResponse(signal, [READY])));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.unauthorized).toBe(1);
    expect(h.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.calls).toHaveLength(2);
    h.stop();
  });

  it("stops for good once stopped", async () => {
    const h = harness((_n, signal) => streamResponse(signal, [READY], { closeAfter: 0 }));
    await vi.advanceTimersByTimeAsync(0);
    h.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.calls).toHaveLength(1);
  });
});

describe("device sign-in polling", () => {
  const code: DeviceCode = { deviceCode: "d", userCode: "BCDF-GHJK", verificationUri: "u", verificationUriComplete: "u?code", expiresIn: 900, interval: 5 };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("waits while pending, slows down when told to, and returns the token", async () => {
    const answers = [reply(400, { error: { code: "authorization_pending" } }), reply(400, { error: { code: "slow_down" } }), reply(200, { accessToken: "bldt_x", user: { username: "raj" } })];
    const sleeps: number[] = [];
    const api = new Api({ baseUrl: () => "http://x", token: () => null, onUnauthorized: () => {}, userAgent: "t", fetchImpl: async () => answers.shift()! });
    const res = await pollForToken(api, code, { cancelled: () => false, sleep: async (ms) => void sleeps.push(ms) });
    expect(res.accessToken).toBe("bldt_x");
    expect(sleeps).toEqual([5000, 5000, 10000]);
  });

  it("treats 429 like slow_down instead of failing", async () => {
    const answers = [reply(429, { error: { code: "rate_limited", message: "Too many requests" } }), reply(200, { accessToken: "bldt_x", user: { username: "raj" } })];
    const sleeps: number[] = [];
    const api = new Api({ baseUrl: () => "http://x", token: () => null, onUnauthorized: () => {}, userAgent: "t", fetchImpl: async () => answers.shift()! });
    const res = await pollForToken(api, code, { cancelled: () => false, sleep: async (ms) => void sleeps.push(ms) });
    expect(res.accessToken).toBe("bldt_x");
    expect(sleeps).toEqual([5000, 10000]);
  });

  it("keeps polling through network errors", async () => {
    const answers: (() => Response)[] = [
      () => {
        throw new TypeError("fetch failed");
      },
      () => reply(200, { accessToken: "bldt_x", user: { username: "raj" } }),
    ];
    const api = new Api({ baseUrl: () => "http://x", token: () => null, onUnauthorized: () => {}, userAgent: "t", fetchImpl: async () => answers.shift()!() });
    const res = await pollForToken(api, code, { cancelled: () => false, sleep: async () => {} });
    expect(res.accessToken).toBe("bldt_x");
  });

  it("stops on denial, expiry and cancellation", async () => {
    const api = (body: unknown) => new Api({ baseUrl: () => "http://x", token: () => null, onUnauthorized: () => {}, userAgent: "t", fetchImpl: async () => reply(400, body) });
    await expect(pollForToken(api({ error: { code: "access_denied", message: "Declined" } }), code, { cancelled: () => false, sleep: async () => {} })).rejects.toMatchObject({ code: "access_denied" });
    let t = 0;
    await expect(pollForToken(api({ error: { code: "authorization_pending" } }), code, { cancelled: () => false, sleep: async () => void (t += 1_000_000), now: () => t })).rejects.toMatchObject({ code: "expired_token" });
    await expect(pollForToken(api({}), code, { cancelled: () => true, sleep: async () => {} })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("Api", () => {
  it("sends nothing until an address is set", async () => {
    let calls = 0;
    const api = new Api({ baseUrl: () => "", token: () => "t", onUnauthorized: () => {}, userAgent: "t", fetchImpl: async () => (calls++, new Response("{}")) });
    await expect(api.get("/me")).rejects.toMatchObject({ code: "not_configured" });
    expect(calls).toBe(0);
  });
});
