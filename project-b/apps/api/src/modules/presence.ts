import { createHash, randomBytes } from "node:crypto";
import { PresenceInput, StartHuddleInput, taskIdentifier, type HuddleItem, type OverlapWarning, type PresenceEntry } from "@bldt/contracts";
import { notify } from "@bldt/core";
import type { Huddle, User } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize } from "../lib/access.ts";
import { toUserRef } from "../lib/dto.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";

/**
 * Who is working on what, right now. Editors send a heartbeat; entries live in Redis and are
 * considered gone after FRESH_MS without one, so a closed laptop disappears on its own. Changes are
 * announced on the same Postgres channel as other live updates, so every API replica sees them.
 */

export const FRESH_MS = 90_000;
const HUDDLE_TTL_MS = 2 * 3600 * 1000;
/** One conflict warning per pair of people per file in this window. */
const OVERLAP_WINDOW_SEC = 6 * 3600;
const MEETING_HOSTS = ["meet.google.com", "zoom.us", "teams.microsoft.com", "teams.live.com", "whereby.com", "meet.jit.si", "around.co"];

function isMeetingHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const LIVE_SHARE = /^https:\/\/prod\.liveshare\.vsengsaas\.visualstudio\.com\/join\?[\w=&%-]+$/;

interface Stored {
  userId: string;
  state: "active" | "idle";
  branch: string | null;
  filePath: string | null;
  taskNumber: number | null;
  client: string;
  since: number;
  at: number;
}

const key = (projectId: string) => `pres:${projectId}`;
const userSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export const presenceRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, redis } = app.deps;

  async function readProject(projectId: string, now = Date.now()): Promise<Stored[]> {
    const all = await redis.hgetall(key(projectId));
    const fresh: Stored[] = [];
    const stale: string[] = [];
    for (const [uid, raw] of Object.entries(all)) {
      try {
        const s = JSON.parse(raw) as Stored;
        if (now - s.at <= FRESH_MS) fresh.push(s);
        else stale.push(uid);
      } catch {
        stale.push(uid);
      }
    }
    if (stale.length) await redis.hdel(key(projectId), ...stale);
    return fresh;
  }

  async function announce(projectId: string) {
    // Reuses the realtime channel: every API replica's listener routes it to project members.
    await db.$executeRaw`SELECT pg_notify('bldt_realtime', ${JSON.stringify({ k: "presence", p: projectId })})`;
  }

  async function toEntries(projectId: string, rows: Stored[]): Promise<PresenceEntry[]> {
    if (!rows.length) return [];
    const [users, project, tasks] = await Promise.all([
      db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: userSelect }),
      db.project.findUniqueOrThrow({ where: { id: projectId }, select: { key: true } }),
      db.task.findMany({ where: { projectId, number: { in: rows.flatMap((r) => (r.taskNumber ? [r.taskNumber] : [])) } }, select: { number: true, title: true } }),
    ]);
    return rows
      .flatMap((r) => {
        const u = users.find((x) => x.id === r.userId);
        if (!u) return [];
        const t = tasks.find((x) => x.number === r.taskNumber);
        const entry: PresenceEntry = {
          user: toUserRef(u),
          state: r.state,
          branch: r.branch,
          filePath: r.filePath,
          task: t ? { number: t.number, identifier: taskIdentifier(project.key, t.number), title: t.title } : null,
          client: r.client,
          since: new Date(r.since).toISOString(),
          lastSeenAt: new Date(r.at).toISOString(),
        };
        return [entry];
      })
      .sort((a, b) => (a.state === b.state ? a.user.displayName.localeCompare(b.user.displayName) : a.state === "active" ? -1 : 1));
  }

  async function memberProject(viewer: User, owner: string, slug: string) {
    const access = await authorize(db, { owner, slug }, viewer, "tasks.view");
    if (!access.role) throw forbidden("Presence is shared with project members only");
    return access.project;
  }

  /** Heartbeat. Returns teammates in the same file, so the editor can warn before a merge conflict. */
  app.put("/me/presence", { schema: { body: PresenceInput }, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const viewer = requireViewer(req);
    const project = await memberProject(viewer, req.body.owner, req.body.slug);
    const now = Date.now();
    const filePath = req.body.filePath?.replace(/\\/g, "/") ?? null;
    const branch = req.body.branch ?? null;
    const prevRaw = await redis.hget(key(project.id), viewer.id);
    const prev = prevRaw ? (JSON.parse(prevRaw) as Stored) : null;
    const prevFresh = prev && now - prev.at <= FRESH_MS;
    const sameSpot = prevFresh && prev.branch === branch && prev.filePath === filePath;
    const next: Stored = {
      userId: viewer.id,
      state: req.body.state,
      branch,
      filePath,
      taskNumber: req.body.taskNumber ?? null,
      client: req.body.client,
      since: sameSpot ? prev.since : now,
      at: now,
    };
    await redis.multi().hset(key(project.id), viewer.id, JSON.stringify(next)).expire(key(project.id), 3600).exec();
    const changed = !prevFresh || !sameSpot || prev.state !== next.state || prev.taskNumber !== next.taskNumber;
    if (changed) await announce(project.id);

    const overlaps: OverlapWarning[] = [];
    if (filePath) {
      const others = (await readProject(project.id, now)).filter((s) => s.userId !== viewer.id && s.filePath === filePath);
      if (others.length) {
        const users = await db.user.findMany({ where: { id: { in: others.map((o) => o.userId) } }, select: userSelect });
        for (const o of others) {
          const u = users.find((x) => x.id === o.userId);
          if (!u) continue;
          overlaps.push({ user: toUserRef(u), filePath, branch: o.branch, sameBranch: o.branch === branch });
          // Tell the other person too, once per pair and file in the window.
          const pair = [viewer.id, o.userId].sort().join(":");
          const dedupe = `ovl:${project.id}:${pair}:${createHash("sha256").update(filePath).digest("hex").slice(0, 16)}`;
          if (await redis.set(dedupe, "1", "EX", OVERLAP_WINDOW_SEC, "NX")) {
            await notify(db, [o.userId], "presence.overlap", {
              projectName: project.name,
              projectSlug: project.slug,
              ownerUsername: req.body.owner,
              filePath,
              who: viewer.displayName,
              theirBranch: branch,
              yourBranch: o.branch,
            }, { projectId: project.id });
          }
        }
      }
    }
    return { overlaps, freshForSeconds: FRESH_MS / 1000 };
  });

  /** Going invisible, or the editor closing. */
  app.delete("/me/presence", { schema: { querystring: z.object({ owner: z.string().min(1).max(39), slug: z.string().min(1).max(64) }) } }, async (req) => {
    const viewer = requireViewer(req);
    const project = await memberProject(viewer, req.query.owner, req.query.slug);
    if (await redis.hdel(key(project.id), viewer.id)) await announce(project.id);
    return { ok: true };
  });

  app.get("/projects/:owner/:slug/presence", { schema: { params: ProjectParams } }, async (req) => {
    const viewer = requireViewer(req);
    const project = await memberProject(viewer, req.params.owner, req.params.slug);
    return { items: await toEntries(project.id, await readProject(project.id)), freshForSeconds: FRESH_MS / 1000 };
  });

  /** Everyone online across the viewer's projects, for the editor's team view. */
  app.get("/me/team", async (req) => {
    const viewer = requireViewer(req);
    const memberships = await db.projectMember.findMany({
      where: { userId: viewer.id, project: { deletedAt: null } },
      select: { project: { select: { id: true, name: true, slug: true, owner: { select: { username: true } } } } },
    });
    const groups = await Promise.all(
      memberships.map(async ({ project: p }) => ({
        project: { name: p.name, slug: p.slug, ownerUsername: p.owner.username },
        people: (await toEntries(p.id, await readProject(p.id))).filter((e) => e.user.id !== viewer.id),
      })),
    );
    return { items: groups.filter((g) => g.people.length > 0) };
  });

  // ── Huddles ────────────────────────────────────────────────

  const toHuddle = (h: Huddle & { host: { id: string; username: string; displayName: string; avatarUrl: string | null }; project: { name: string; slug: string; owner: { username: string } } }): HuddleItem => ({
    id: h.id,
    kind: h.kind,
    url: h.url,
    topic: h.topic,
    host: toUserRef(h.host),
    project: { name: h.project.name, slug: h.project.slug, ownerUsername: h.project.owner.username },
    createdAt: h.createdAt.toISOString(),
    endsAt: h.endsAt.toISOString(),
    active: !h.endedAt && h.endsAt > new Date(),
  });
  const huddleInclude = { host: { select: userSelect }, project: { select: { name: true, slug: true, owner: { select: { username: true } } } } } as const;

  app.post("/projects/:owner/:slug/huddles", { schema: { params: ProjectParams, body: StartHuddleInput }, config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const project = await memberProject(viewer, req.params.owner, req.params.slug);
    const { kind, topic } = req.body;

    let url: string;
    if (kind === "PAIR") {
      if (!req.body.url || !LIVE_SHARE.test(req.body.url)) throw badRequest("Pairing needs a Live Share link from VS Code", [{ path: "url", message: "Not a Live Share link" }]);
      url = req.body.url;
    } else {
      const candidate = req.body.url ?? viewer.meetingUrl ?? `https://meet.jit.si/bldt-${req.params.slug.replace(/[^a-z0-9-]/gi, "")}-${randomBytes(6).toString("hex")}`;
      if (!/^https:\/\//.test(candidate)) throw badRequest("Meeting links must use https", [{ path: "url", message: "Must use https" }]);
      // The link lands in teammates' notifications: only the host's saved room or a known meeting service.
      if (req.body.url && req.body.url !== viewer.meetingUrl && !isMeetingHost(req.body.url)) {
        throw badRequest("Use a Google Meet, Zoom, Teams, Whereby, Jitsi or Around link, or save your own room in Settings", [{ path: "url", message: "Unknown meeting service" }]);
      }
      url = candidate;
    }

    // Default audience: whoever is online in the project right now.
    let invitees = [...new Set(req.body.invitees)].filter((id) => id !== viewer.id);
    if (invitees.length === 0) invitees = (await readProject(project.id)).map((s) => s.userId).filter((id) => id !== viewer.id);
    if (invitees.length === 0) throw badRequest("Nobody else is online in this project. Pick teammates to invite.");
    const members = await db.projectMember.findMany({ where: { projectId: project.id, userId: { in: invitees } }, select: { userId: true } });
    if (members.length !== invitees.length) throw badRequest("Everyone you invite must be a project member");

    const h = await db.huddle.create({
      data: { projectId: project.id, hostId: viewer.id, kind, url, topic: topic || null, invitees, endsAt: new Date(Date.now() + HUDDLE_TTL_MS) },
      include: huddleInclude,
    });
    await notify(db, invitees, "huddle.invite", {
      huddleId: h.id,
      kind,
      url,
      topic: topic || null,
      host: viewer.displayName,
      projectName: project.name,
      projectSlug: project.slug,
      ownerUsername: req.params.owner,
    }, { projectId: project.id });
    return reply.status(201).send({ huddle: toHuddle(h), invited: invitees.length });
  });

  app.get("/me/huddles", async (req) => {
    const viewer = requireViewer(req);
    const rows = await db.huddle.findMany({
      where: { endedAt: null, endsAt: { gt: new Date() }, OR: [{ hostId: viewer.id }, { invitees: { has: viewer.id } }] },
      include: huddleInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { items: rows.map(toHuddle) };
  });

  app.post("/huddles/:id/end", { schema: { params: z.object({ id: z.uuid() }) } }, async (req) => {
    const viewer = requireViewer(req);
    const h = await db.huddle.findUnique({ where: { id: req.params.id } });
    if (!h) throw notFound("Huddle not found");
    if (h.hostId !== viewer.id) throw forbidden("Only the host can end it");
    await db.huddle.update({ where: { id: h.id }, data: { endedAt: new Date() } });
    return { ok: true };
  });
};
