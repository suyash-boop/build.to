/** Server-sent events over fetch (Node has no EventSource), with incremental parsing. */

export interface SseEvent {
  event: string;
  data: string;
}

/** Feed chunks in, get complete events out. Handles CRLF, comments, multi-line data. */
export class SseParser {
  private buf = "";

  push(chunk: string): SseEvent[] {
    this.buf += chunk.replace(/\r\n?/g, "\n");
    const out: SseEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length || event !== "message") out.push({ event, data: data.join("\n") });
    }
    return out;
  }
}

export interface StreamOptions {
  url: string;
  headers: () => Record<string, string> | null;
  onEvent: (e: SseEvent) => void;
  /** Called on every (re)connect after the first, so the caller can refetch what it missed. */
  onReconnect: () => void;
  /** 401: the caller checks the session (and signs out if it is gone); the stream retries with backoff. */
  onUnauthorized: () => void;
  log: (msg: string) => void;
  fetchImpl?: typeof fetch;
  random?: () => number;
}

/** A connection has to hold this long before backoff resets; a server that accepts and drops keeps backing off. */
export const STABLE_AFTER_MS = 30_000;
/** The server sends a ": ping" every 25 seconds, so this long without a byte means the connection is dead. */
export const READ_TIMEOUT_MS = 60_000;

/** Exponential, capped at a minute, with up to 2 seconds of jitter so many editors do not reconnect in lockstep. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  return Math.min(60_000, 1_000 * 2 ** attempt) + Math.floor(random() * 2_000);
}

/** Keep one stream open, reconnecting with capped backoff. Returns a function that stops it. */
export function openStream(opts: StreamOptions): () => void {
  const f = opts.fetchImpl ?? fetch;
  const random = opts.random ?? Math.random;
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;
  let connectedOnce = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, backoffDelay(attempt++, random));
  };

  const run = async () => {
    timer = null;
    const headers = opts.headers();
    if (!headers || stopped) return;
    const ctrl = new AbortController();
    controller = ctrl;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let readyAt: number | null = null;
    let stalled = false;
    // Covers a server that never answers as well as a connection that silently died mid-stream.
    const arm = () => {
      clearWatchdog();
      watchdog = setTimeout(() => {
        stalled = true;
        ctrl.abort();
        void reader?.cancel().catch(() => {});
      }, READ_TIMEOUT_MS);
    };
    try {
      arm();
      const res = await f(opts.url, { headers: { ...headers, accept: "text/event-stream" }, signal: ctrl.signal });
      if (res.status === 401) {
        opts.onUnauthorized();
        throw new Error("HTTP 401");
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const parser = new SseParser();
      const decoder = new TextDecoder();
      reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm();
        for (const e of parser.push(decoder.decode(value, { stream: true }))) {
          if (e.event === "ready") {
            readyAt = Date.now();
            if (connectedOnce) opts.onReconnect();
            connectedOnce = true;
          } else opts.onEvent(e);
        }
      }
      throw new Error("stream ended");
    } catch (err) {
      clearWatchdog();
      if (stopped) return;
      if (readyAt !== null && Date.now() - readyAt >= STABLE_AFTER_MS) attempt = 0;
      opts.log(`live updates disconnected (${stalled ? `no data for ${READ_TIMEOUT_MS / 1000}s` : (err as Error).message}); retrying`);
      schedule();
    }
  };

  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    clearWatchdog();
    controller?.abort();
  };
}
