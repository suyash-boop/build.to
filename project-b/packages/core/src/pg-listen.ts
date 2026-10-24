import pg from "pg";

/** Minimal logger shape, satisfied by pino and Fastify loggers. */
export interface ListenLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
}

export const CHANNEL = "bldt_realtime";

export type ChangeKind = "task" | "comment" | "milestone" | "activity" | "signal" | "discussion" | "presence" | "project" | "member" | "notification";

export interface RawChange {
  k: ChangeKind;
  /** Project id. */
  p?: string;
  /** User id (member and notification changes). */
  u?: string;
  op?: string;
}

export interface ChangeSource {
  start(onChange: (c: RawChange) => void, onReady: (reconnected: boolean) => void): void;
  stop(): Promise<void>;
}

/**
 * LISTEN on a dedicated connection. Must be a direct (non-pooled) URL: transaction poolers do not
 * keep LISTEN registrations. Reconnects with capped backoff and probes the connection so a
 * silently dead socket is noticed within a minute.
 */
export class PgChangeSource implements ChangeSource {
  private client: pg.Client | null = null;
  private attempt = 0;
  private everConnected = false;
  private stopped = false;
  private retry: NodeJS.Timeout | null = null;
  private probe: NodeJS.Timeout | null = null;

  constructor(
    private connectionString: string,
    private log: ListenLogger,
  ) {}

  start(onChange: (c: RawChange) => void, onReady: (reconnected: boolean) => void) {
    void this.connect(onChange, onReady);
  }

  private async connect(onChange: (c: RawChange) => void, onReady: (reconnected: boolean) => void) {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.connectionString, keepAlive: true, application_name: "bldt-realtime" });
    this.client = client;
    let failed = false;
    const fail = (err?: unknown) => {
      if (failed || this.stopped) return;
      failed = true;
      if (this.probe) clearInterval(this.probe);
      client.removeAllListeners();
      client.on("error", () => {});
      void client.end().catch(() => {});
      const delay = Math.min(30_000, 500 * 2 ** this.attempt++) + Math.floor(Math.random() * 250);
      this.log.warn({ err, delay }, "realtime listener disconnected; retrying");
      this.retry = setTimeout(() => void this.connect(onChange, onReady), delay);
      this.retry.unref();
    };
    client.on("error", fail);
    client.on("end", () => fail());
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        onChange(JSON.parse(msg.payload) as RawChange);
      } catch {
        this.log.warn("realtime payload was not JSON");
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (err) {
      return fail(err);
    }
    this.attempt = 0;
    const reconnected = this.everConnected;
    this.everConnected = true;
    this.log.info({ reconnected }, "realtime listener ready");
    onReady(reconnected);
    this.probe = setInterval(() => {
      const timeout = setTimeout(() => fail(new Error("probe timed out")), 10_000);
      client.query("SELECT 1").then(() => clearTimeout(timeout), (err) => (clearTimeout(timeout), fail(err)));
    }, 45_000);
    this.probe.unref();
  }

  async stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.probe) clearInterval(this.probe);
    const c = this.client;
    this.client = null;
    if (c) {
      c.removeAllListeners();
      c.on("error", () => {});
      await c.end().catch(() => {});
    }
  }
}
