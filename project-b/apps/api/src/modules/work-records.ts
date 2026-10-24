import type { SignedWorkRecord, WorkRecordClaims, WorkRecordItem, WorkRecordVerification, WorkRecordView } from "@bldt/contracts";
import { buildClaims, signClaims, verifySigned } from "@bldt/core";
import type { WorkRecord } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize } from "../lib/access.ts";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";

const DAY = 86_400_000;
const MAX_SPAN_DAYS = 5 * 366;
export const MAX_RECORDS_PER_DAY = 20;

const IssueInput = z.object({
  owner: z.string().min(1).max(39),
  slug: z.string().min(1).max(64),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

function toItem(r: WorkRecord): WorkRecordItem {
  const claims = JSON.parse(r.canonical) as WorkRecordClaims;
  const url = claims.project.url ? new URL(claims.project.url) : null;
  const [owner, slug] = url ? url.pathname.split("/").filter(Boolean) : [null, null];
  return {
    id: r.id,
    project: { name: claims.project.name, owner: owner ?? null, slug: slug ?? null, visibility: claims.project.visibility },
    period: claims.period,
    summary: claims.summary,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
  };
}

export const workRecordRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env } = app.deps;
  const keys = () => {
    const k = app.deps.workKeys;
    if (!k) throw new AppError(503, "work_records_unavailable", "Work records are not enabled on this server");
    return k;
  };

  /** Public JWKS. The web app serves it at /.well-known/bldt-keys.json. */
  app.get("/keys", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=3600");
    return keys().jwks;
  });

  app.get("/me/work-records", async (req) => {
    const viewer = requireViewer(req);
    const rows = await db.workRecord.findMany({ where: { userId: viewer.id }, orderBy: { createdAt: "desc" }, take: 200 });
    return { items: rows.map(toItem), enabled: app.deps.workKeys !== null };
  });

  app.post("/me/work-records", { schema: { body: IssueInput }, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const ring = keys();
    const { project, role } = await authorize(db, { owner: req.body.owner, slug: req.body.slug }, viewer, "tasks.view");
    // Only members can issue, and only about themselves.
    if (!role) throw forbidden("Only project members can issue a work record");
    const member = await db.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: project.id, userId: viewer.id } } });

    const now = new Date();
    const from = req.body.from ? new Date(`${req.body.from}T00:00:00.000Z`) : new Date(Date.UTC(member.joinedAt.getUTCFullYear(), member.joinedAt.getUTCMonth(), member.joinedAt.getUTCDate()));
    const to = req.body.to ? new Date(`${req.body.to}T23:59:59.999Z`) : now;
    if (from > to) throw badRequest("The period must start before it ends", [{ path: "from", message: "Must be before the end date" }]);
    if (from > now) throw badRequest("The period cannot start in the future", [{ path: "from", message: "Cannot be in the future" }]);
    if ((to.getTime() - from.getTime()) / DAY > MAX_SPAN_DAYS) throw badRequest("A record can cover at most five years", [{ path: "from", message: "At most five years" }]);
    const until = to > now ? now : to;

    const recent = await db.workRecord.count({ where: { userId: viewer.id, createdAt: { gte: new Date(now.getTime() - DAY) } } });
    if (recent >= MAX_RECORDS_PER_DAY) throw new AppError(429, "too_many_records", `You can issue up to ${MAX_RECORDS_PER_DAY} records a day`);

    const id = crypto.randomUUID();
    const claims = await buildClaims(db, { recordId: id, userId: viewer.id, projectId: project.id, from, to: until, issuer: `${env.WEB_ORIGIN.replace(/\/$/, "")}/projects`, now });
    const { canonical, signed } = signClaims(claims, ring.current);
    const row = await db.workRecord.create({
      data: { id, userId: viewer.id, projectId: project.id, kid: signed.signature.kid, canonical, signature: signed.signature.value, periodFrom: from, periodTo: until },
    });
    return reply.status(201).send({ item: toItem(row), signed });
  });

  app.post(
    "/me/work-records/:id/revoke",
    { schema: { params: z.object({ id: z.uuid() }), body: z.object({ reason: z.string().trim().max(200).optional() }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const { count } = await db.workRecord.updateMany({
        where: { id: req.params.id, userId: viewer.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: req.body.reason || null },
      });
      if (count === 0) throw notFound("Record not found");
      return { ok: true };
    },
  );

  /** Public: anyone with the link can see a record and its status. */
  app.get("/work-records/:id", { schema: { params: z.object({ id: z.uuid() }) } }, async (req, reply) => {
    const ring = keys();
    const r = await db.workRecord.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound("No record with this id. It may have been deleted with its holder's account.");
    const signed: SignedWorkRecord = { record: JSON.parse(r.canonical) as WorkRecordClaims, signature: { alg: "Ed25519", kid: r.kid, value: r.signature } };
    // Re-verify on every read: a modified row must never be presented as genuine.
    const check = verifySigned(signed, ring.byKid);
    const intact = check.valid && check.canonical === r.canonical;
    const view: WorkRecordView = {
      signed,
      status: !intact ? "invalid" : r.revokedAt ? "revoked" : "valid",
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokedReason: r.revokedReason,
      keyStatus: r.kid === ring.current.kid ? "current" : ring.byKid.has(r.kid) ? "retired" : "unknown",
    };
    reply.header("cache-control", "no-store");
    return view;
  });

  /** Public: verify a record document someone handed you. */
  app.post("/work-records/verify", { bodyLimit: 256 * 1024, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const ring = keys();
    const check = verifySigned(req.body, ring.byKid);
    if (!check.valid) {
      const result: WorkRecordVerification = { status: "invalid", reason: check.reason, record: null, revokedAt: null };
      return result;
    }
    const record = (req.body as SignedWorkRecord).record;
    const stored = typeof record.id === "string" && z.uuid().safeParse(record.id).success ? await db.workRecord.findUnique({ where: { id: record.id } }) : null;
    // A genuine signature is enough to prove authenticity; the registry adds revocation status.
    const result: WorkRecordVerification = {
      status: !stored ? "unknown_record" : stored.revokedAt ? "revoked" : "valid",
      reason: null,
      record,
      revokedAt: stored?.revokedAt?.toISOString() ?? null,
    };
    return result;
  });
};
