import type { RealtimeChange } from "@bldt/contracts";
import type { Db } from "@bldt/db";
import type { FastifyBaseLogger } from "fastify";
import { CHANNEL, PgChangeSource, type ChangeKind, type ChangeSource, type RawChange } from "@bldt/core";

export { CHANNEL, PgChangeSource, type ChangeKind, type ChangeSource, type RawChange };

/**
 * Realtime fan-out. Postgres triggers publish row-change ids on the `bldt_realtime` channel
 * (see the realtime_triggers migration); one LISTEN connection per API process receives them and
 * this hub routes each to the connected users allowed to see it. Payloads never carry row data,
 * only "something changed in project X", so a leak can at most reveal that activity happened.
 */

export interface ProjectRef {
  owner: string;
  slug: string;
}

/** What a browser receives. `projects` means the viewer's own project list changed. */
export type ClientChange = RealtimeChange;


export interface Subscriber {
  readonly id: number;
  readonly userId: string;
  readonly sessionId: string | null;
  projects: Set<string>;
  pending: Map<string, ClientChange>;
  timer: NodeJS.Timeout | null;
  /** Writes one SSE frame; returns false when the socket is backed up. */
  write(frame: string): boolean;
  /** Bytes queued on the socket, for backpressure. */
  buffered(): number;
  end(): void;
}

const FLUSH_MS = 150;
const HEARTBEAT_MS = 25_000;
/** Every this many heartbeats, sessions are re-checked so sign-out and revocation cut the stream. */
const SESSION_CHECK_EVERY = 8;
const MAX_BUFFERED = 512 * 1024;
export const MAX_STREAMS_PER_USER = 6;

export class RealtimeHub {
  private seq = 0;
  private byUser = new Map<string, Set<Subscriber>>();
  private byProject = new Map<string, Set<Subscriber>>();
  private refs = new Map<string, ProjectRef>();
  private heartbeat: NodeJS.Timeout | null = null;
  private beats = 0;
  private closed = false;

  constructor(
    private db: Db,
    private source: ChangeSource,
    private log: FastifyBaseLogger,
  ) {}

  start() {
    this.source.start(
      (c) => void this.handle(c).catch((err) => this.log.warn({ err, change: c }, "realtime change failed")),
      (reconnected) => {
        // Changes during the outage were lost; tell every client to refetch.
        if (reconnected) for (const sub of this.all()) this.queue(sub, { k: "resync" });
      },
    );
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  get size() {
    let n = 0;
    for (const set of this.byUser.values()) n += set.size;
    return n;
  }

  async subscribe(init: { userId: string; sessionId: string | null; write: Subscriber["write"]; buffered: Subscriber["buffered"]; end: Subscriber["end"] }): Promise<Subscriber> {
    const sub: Subscriber = { id: ++this.seq, userId: init.userId, sessionId: init.sessionId, projects: new Set(), pending: new Map(), timer: null, write: init.write, buffered: init.buffered, end: init.end };

    // A forgotten tab should not block a new one: past the cap, the oldest stream is closed.
    const mine = this.byUser.get(sub.userId) ?? new Set<Subscriber>();
    while (mine.size >= MAX_STREAMS_PER_USER) {
      const oldest = mine.values().next().value!;
      this.drop(oldest);
    }
    mine.add(sub);
    this.byUser.set(sub.userId, mine);

    let rows;
    try {
      rows = await this.db.projectMember.findMany({
        where: { userId: sub.userId, project: { deletedAt: null } },
        select: { projectId: true, project: { select: { slug: true, owner: { select: { username: true } } } } },
      });
    } catch (err) {
      // Never leave a half-registered subscriber holding one of the user's stream slots.
      this.unsubscribe(sub);
      throw err;
    }
    // The stream may have closed while memberships loaded.
    if (!this.byUser.get(sub.userId)?.has(sub)) return sub;
    for (const r of rows) {
      this.refs.set(r.projectId, { owner: r.project.owner.username, slug: r.project.slug });
      this.follow(sub, r.projectId);
    }
    return sub;
  }

  unsubscribe(sub: Subscriber) {
    if (sub.timer) clearTimeout(sub.timer);
    sub.timer = null;
    const mine = this.byUser.get(sub.userId);
    mine?.delete(sub);
    if (mine?.size === 0) this.byUser.delete(sub.userId);
    for (const pid of sub.projects) this.unfollow(sub, pid);
  }

  /** Route one change from the database to the subscribers allowed to see it. */
  async handle(c: RawChange) {
    switch (c.k) {
      case "notification": {
        for (const sub of this.byUser.get(c.u ?? "") ?? []) this.queue(sub, { k: "notification" });
        return;
      }
      case "member": {
        if (!c.p || !c.u) return;
        const userSubs = [...(this.byUser.get(c.u) ?? [])];
        if (c.op === "delete") {
          // Removed from the project: stop sending its changes before anything else.
          for (const sub of userSubs) {
            this.unfollow(sub, c.p);
            this.queue(sub, { k: "projects" });
          }
        } else if (userSubs.length) {
          const ref = await this.ref(c.p);
          if (ref) {
            for (const sub of userSubs) {
              this.follow(sub, c.p);
              this.queue(sub, { k: "projects" });
            }
          }
        }
        const ref = this.refs.get(c.p);
        if (ref) for (const sub of this.byProject.get(c.p) ?? []) this.queue(sub, { k: "member", project: ref }, c.p);
        return;
      }
      case "project": {
        if (!c.p || !this.byProject.has(c.p)) return;
        const before = this.refs.get(c.p);
        const project = await this.db.project.findUnique({ where: { id: c.p }, select: { slug: true, deletedAt: true, owner: { select: { username: true } } } });
        const subs = [...(this.byProject.get(c.p) ?? [])];
        if (!project || project.deletedAt) {
          for (const sub of subs) {
            this.unfollow(sub, c.p);
            this.queue(sub, { k: "projects" });
          }
          return;
        }
        const ref = { owner: project.owner.username, slug: project.slug };
        this.refs.set(c.p, ref);
        for (const sub of subs) {
          this.queue(sub, { k: "project", project: before ?? ref }, c.p);
          // Renames and transfers change the sidebar too.
          if (before && (before.owner !== ref.owner || before.slug !== ref.slug)) this.queue(sub, { k: "projects" });
        }
        return;
      }
      default: {
        if (!c.p) return;
        const ref = this.refs.get(c.p);
        if (!ref) return;
        for (const sub of this.byProject.get(c.p) ?? []) this.queue(sub, { k: c.k, project: ref }, c.p);
      }
    }
  }

  async close() {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const sub of this.all()) this.drop(sub);
    await this.source.stop();
  }

  private all() {
    const out: Subscriber[] = [];
    for (const set of this.byUser.values()) out.push(...set);
    return out;
  }

  private follow(sub: Subscriber, pid: string) {
    sub.projects.add(pid);
    const set = this.byProject.get(pid) ?? new Set<Subscriber>();
    set.add(sub);
    this.byProject.set(pid, set);
  }

  private unfollow(sub: Subscriber, pid: string) {
    sub.projects.delete(pid);
    // Drop queued changes for that project too: nothing about it should arrive after removal.
    for (const key of sub.pending.keys()) if (key.endsWith(`@${pid}`)) sub.pending.delete(key);
    const set = this.byProject.get(pid);
    set?.delete(sub);
    if (set?.size === 0) {
      this.byProject.delete(pid);
      this.refs.delete(pid);
    }
  }

  private async ref(pid: string): Promise<ProjectRef | null> {
    const known = this.refs.get(pid);
    if (known) return known;
    const p = await this.db.project.findUnique({ where: { id: pid }, select: { slug: true, deletedAt: true, owner: { select: { username: true } } } });
    if (!p || p.deletedAt) return null;
    const ref = { owner: p.owner.username, slug: p.slug };
    this.refs.set(pid, ref);
    return ref;
  }

  /** Coalesce: a burst of changes to one project becomes one message per kind per flush. */
  private queue(sub: Subscriber, change: ClientChange, pid?: string) {
    if (this.closed) return;
    const key = pid ? `${change.k}@${pid}` : change.k;
    sub.pending.set(key, change);
    sub.timer ??= setTimeout(() => this.flush(sub), FLUSH_MS);
  }

  private flush(sub: Subscriber) {
    sub.timer = null;
    if (sub.pending.size === 0) return;
    const batch = [...sub.pending.values()];
    sub.pending.clear();
    this.send(sub, `event: change\ndata: ${JSON.stringify(batch)}\n\n`);
  }

  private send(sub: Subscriber, frame: string) {
    // A client that stops reading is dropped rather than buffered without bound; it reconnects and resyncs.
    if (sub.buffered() > MAX_BUFFERED) return this.drop(sub);
    sub.write(frame);
  }

  private drop(sub: Subscriber) {
    this.unsubscribe(sub);
    sub.end();
  }

  private async beat() {
    const subs = this.all();
    for (const sub of subs) this.send(sub, ": ping\n\n");
    if (++this.beats % SESSION_CHECK_EVERY !== 0) return;
    const ids = [...new Set(subs.map((s) => s.sessionId).filter((s): s is string => s != null))];
    if (!ids.length) return;
    try {
      const live = new Set((await this.db.session.findMany({ where: { id: { in: ids }, expiresAt: { gt: new Date() } }, select: { id: true } })).map((s) => s.id));
      for (const sub of subs) if (sub.sessionId && !live.has(sub.sessionId)) this.drop(sub);
    } catch (err) {
      this.log.warn({ err }, "realtime session check failed");
    }
  }
}
