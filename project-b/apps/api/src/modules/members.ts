import {
  canAssignRole,
  DecideInput,
  InviteInput,
  JoinRequestInput,
  RespondInviteInput,
  UpdateMemberInput,
  UpdateMyMembershipInput,
  type InvitationItem,
  type MemberItem,
  type SuggestedPerson,
} from "@bldt/contracts";
import { notify, platformEvent, recordActivity } from "@bldt/core";
import type { Prisma } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize, resolveProject } from "../lib/access.ts";
import { audit } from "../lib/audit.ts";
import { generateToken, sha256 } from "../lib/crypto.ts";
import { sumContributions, toUserRef, userRefSelect } from "../lib/dto.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts";
import { matchScore, personCards, publicMembership } from "../lib/people.ts";
import { requireBrowserSession, requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";

const INVITE_TTL_MS = 14 * 24 * 3600 * 1000;

export const invitationInclude = {
  project: { select: { id: true, name: true, slug: true, owner: { select: userRefSelect } } },
  inviter: { select: userRefSelect },
  invitee: { select: userRefSelect },
} satisfies Prisma.InvitationInclude;

export function toInvitation(i: Prisma.InvitationGetPayload<{ include: typeof invitationInclude }>): InvitationItem {
  return {
    id: i.id,
    project: { id: i.project.id, name: i.project.name, slug: i.project.slug, owner: toUserRef(i.project.owner) },
    inviter: toUserRef(i.inviter),
    invitee: i.invitee ? toUserRef(i.invitee) : null,
    role: i.role,
    status: i.status === "PENDING" && i.expiresAt < new Date() ? "EXPIRED" : i.status,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  app.get("/projects/:owner/:slug/members", { schema: { params: ProjectParams } }, async (req) => {
    const { project } = await authorize(db, req.params, req.viewer, "members.view");
    const [members, contributions] = await Promise.all([
      db.projectMember.findMany({
        where: { projectId: project.id },
        include: { user: { select: userRefSelect } },
      }),
      db.contribution.findMany({ where: { projectId: project.id, userId: { not: null } } }),
    ]);
    const byUser = new Map<string, typeof contributions>();
    for (const c of contributions) byUser.set(c.userId!, [...(byUser.get(c.userId!) ?? []), c]);

    // Enum declaration order is OWNER, MAINTAINER, CONTRIBUTOR, VIEWER; sort explicitly for clarity.
    const rank = { OWNER: 0, MAINTAINER: 1, CONTRIBUTOR: 2, VIEWER: 3 } as const;
    const items: MemberItem[] = members
      .sort((a, b) => rank[a.role] - rank[b.role] || a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((m) => ({
        user: toUserRef(m.user),
        role: m.role,
        title: m.title,
        joinedAt: m.joinedAt.toISOString(),
        contribution: sumContributions(byUser.get(m.userId) ?? []),
      }));

    // Unlinked GitHub contributors: people who committed but are not members (or not on bld.t yet).
    const external = await db.contribution.groupBy({
      by: ["githubLogin"],
      where: { projectId: project.id, OR: [{ userId: null }, { userId: { notIn: members.map((m) => m.userId) } }] },
      _sum: { commits: true, prsMerged: true },
      orderBy: { _sum: { commits: "desc" } },
      take: 20,
    });
    return {
      items,
      externalContributors: external.map((e) => ({
        githubLogin: e.githubLogin,
        commits: e._sum.commits ?? 0,
        prsMerged: e._sum.prsMerged ?? 0,
      })),
    };
  });

  app.patch(
    "/projects/:owner/:slug/members/:userId",
    { schema: { params: ProjectParams.extend({ userId: z.string().min(1).max(128) }), body: UpdateMemberInput } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project, role: actorRole } = await authorize(db, req.params, viewer, "members.manage");
      const target = await db.projectMember.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: req.params.userId } },
      });
      if (!target) throw notFound("Member not found");

      const changingRole = req.body.role && req.body.role !== target.role;
      if (changingRole) {
        if (target.role === "OWNER") throw forbidden("The owner's role cannot be changed");
        if (!canAssignRole(actorRole!, target.role) || !canAssignRole(actorRole!, req.body.role!)) {
          throw forbidden("You can only manage members below your own role");
        }
      }
      // Titles: members may set their own; managers may set anyone's below them.
      if (req.body.title !== undefined && target.userId !== viewer.id && !canAssignRole(actorRole!, target.role)) {
        throw forbidden();
      }

      await db.projectMember.update({
        where: { projectId_userId: { projectId: project.id, userId: target.userId } },
        data: { role: req.body.role, title: req.body.title },
      });
      if (changingRole) {
        await audit(db, req, {
          projectId: project.id,
          action: "member.role",
          targetId: target.userId,
          metadata: { from: target.role, to: req.body.role },
        });
      }
      return { ok: true };
    },
  );

  /** Remove a member, or leave the project when targeting yourself. */
  app.delete(
    "/projects/:owner/:slug/members/:userId",
    { schema: { params: ProjectParams.extend({ userId: z.string().min(1).max(128) }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const self = req.params.userId === viewer.id;
      const { project, role: actorRole } = self
        ? await authorize(db, req.params, viewer, "tasks.view")
        : await authorize(db, req.params, viewer, "members.manage");

      const target = await db.projectMember.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: req.params.userId } },
      });
      if (!target) throw notFound("Member not found");
      if (target.role === "OWNER") throw forbidden(self ? "Transfer ownership before leaving" : "The owner cannot be removed");
      if (!self && !canAssignRole(actorRole!, target.role)) throw forbidden("You can only remove members below your own role");

      await db.$transaction(async (tx) => {
        await tx.projectMember.delete({ where: { projectId_userId: { projectId: project.id, userId: target.userId } } });
        await tx.task.updateMany({
          where: { projectId: project.id, assigneeId: target.userId, status: { notIn: ["DONE", "CANCELED"] } },
          data: { assigneeId: null },
        });
        await recordActivity(tx, platformEvent(project.id, "member.left", target.userId, { removedBy: self ? null : viewer.id }));
      });
      await audit(db, req, { projectId: project.id, action: self ? "member.leave" : "member.remove", targetId: target.userId });
      return { ok: true };
    },
  );

  app.patch(
    "/projects/:owner/:slug/membership",
    { schema: { params: ProjectParams, body: UpdateMyMembershipInput } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project, role } = await resolveProject(db, req.params.owner, req.params.slug, viewer);
      if (!role) throw forbidden("You are not a member of this project");
      await db.projectMember.update({
        where: { projectId_userId: { projectId: project.id, userId: viewer.id } },
        data: req.body,
      });
      return { ok: true };
    },
  );

  /** Owner transfers the project to a current maintainer. */
  app.post(
    "/projects/:owner/:slug/transfer",
    { schema: { params: ProjectParams, body: z.object({ userId: z.string().min(1).max(128) }) } },
    async (req) => {
      const viewer = requireBrowserSession(req);
      const { project } = await authorize(db, req.params, viewer, "project.transfer");
      const target = await db.projectMember.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: req.body.userId } },
        include: { user: true },
      });
      if (!target || target.role !== "MAINTAINER") throw badRequest("Ownership can only be transferred to a maintainer");

      const clash = await db.project.findFirst({
        where: { ownerId: target.userId, OR: [{ slug: project.slug }, { key: project.key }], deletedAt: null },
        select: { id: true },
      });
      if (clash) throw conflict(`${target.user.username} already has a project with this URL or key`);

      await db.$transaction([
        db.project.update({ where: { id: project.id }, data: { ownerId: target.userId } }),
        db.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: target.userId } }, data: { role: "OWNER" } }),
        db.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: viewer.id } }, data: { role: "MAINTAINER" } }),
      ]);
      await audit(db, req, { projectId: project.id, action: "project.transfer", targetId: target.userId });
      return { owner: target.user.username, slug: project.slug };
    },
  );

  /** People outside the project whose public work overlaps its stack. For maintainers deciding whom to invite. */
  app.get("/projects/:owner/:slug/suggested-people", { schema: { params: ProjectParams } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "members.invite");
    const techs = await db.projectTechnology.findMany({
      where: { projectId: project.id, hidden: false },
      select: { technology: { select: { id: true, slug: true, name: true, category: true, color: true } } },
    });
    if (techs.length === 0) return { items: [] };

    const [members, pending] = await Promise.all([
      db.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true } }),
      db.invitation.findMany({ where: { projectId: project.id, status: "PENDING" }, select: { inviteeId: true } }),
    ]);
    const exclude = [...members.map((m) => m.userId), ...pending.map((p) => p.inviteeId).filter((x): x is string => Boolean(x))];
    const candidates = await db.projectMember.findMany({
      where: {
        ...publicMembership,
        userId: { notIn: exclude },
        user: { deletedAt: null },
        project: { ...publicMembership.project, technologies: { some: { hidden: false, technologyId: { in: techs.map((t) => t.technology.id) } } } },
      },
      distinct: ["userId"],
      select: { userId: true },
      take: 200,
    });
    const cards = await personCards(db, candidates.map((c) => c.userId));
    const projectTechs = techs.map(({ technology: t }) => ({ slug: t.slug, name: t.name, category: t.category, color: t.color }));
    const items: SuggestedPerson[] = cards
      .map((c) => ({ c, ...matchScore(new Map(c.technologies.map((t) => [t.slug, { evidenced: t.evidenced }])), projectTechs) }))
      .filter((x) => x.score > 0)
      // Among equal fits, people who said they are open to work first.
      .sort((a, b) => b.score - a.score || Number(b.c.openToWork) - Number(a.c.openToWork))
      .slice(0, 8)
      .map((x) => ({ ...x.c, reason: x.reason }));
    return { items };
  });

  // ── Invitations ─────────────────────────────────────────────

  app.get("/projects/:owner/:slug/invitations", { schema: { params: ProjectParams } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "members.invite");
    const rows = await db.invitation.findMany({
      where: { projectId: project.id, status: "PENDING" },
      include: invitationInclude,
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map(toInvitation) };
  });

  app.post(
    "/projects/:owner/:slug/invitations",
    { schema: { params: ProjectParams, body: InviteInput }, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const viewer = requireViewer(req);
      const { project, role } = await authorize(db, req.params, viewer, "members.invite");
      if (!canAssignRole(role!, req.body.role)) throw forbidden("You can only invite people below your own role");

      const invitee = await db.user.findFirst({ where: { username: req.body.username, deletedAt: null } });
      if (!invitee) throw notFound(`No bld.t user named ${req.body.username}`);
      const existing = await db.projectMember.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: invitee.id } },
      });
      if (existing) throw conflict(`${invitee.username} is already a member`);
      const pending = await db.invitation.findFirst({
        where: { projectId: project.id, inviteeId: invitee.id, status: "PENDING", expiresAt: { gt: new Date() } },
      });
      if (pending) throw conflict(`${invitee.username} already has a pending invitation`);

      const inv = await db.$transaction(async (tx) => {
        const created = await tx.invitation.create({
          data: {
            projectId: project.id,
            inviterId: viewer.id,
            inviteeId: invitee.id,
            role: req.body.role,
            tokenHash: sha256(generateToken()),
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
          include: invitationInclude,
        });
        await notify(tx, [invitee.id], "invitation.received", {
          invitationId: created.id,
          projectName: project.name,
          projectSlug: project.slug,
          ownerUsername: project.owner.username,
          inviter: viewer.username,
          role: req.body.role,
        }, { projectId: project.id });
        return created;
      });
      await audit(db, req, { projectId: project.id, action: "member.invite", targetId: invitee.id, metadata: { role: req.body.role } });
      return reply.status(201).send(toInvitation(inv));
    },
  );

  app.delete(
    "/projects/:owner/:slug/invitations/:id",
    { schema: { params: ProjectParams.extend({ id: z.uuid() }) } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project } = await authorize(db, req.params, viewer, "members.invite");
      const { count } = await db.invitation.updateMany({
        where: { id: req.params.id, projectId: project.id, status: "PENDING" },
        data: { status: "REVOKED", respondedAt: new Date() },
      });
      if (count === 0) throw notFound("Invitation not found");
      return { ok: true };
    },
  );

  app.get("/invitations", async (req) => {
    const viewer = requireViewer(req);
    const rows = await db.invitation.findMany({
      where: { inviteeId: viewer.id, status: "PENDING", expiresAt: { gt: new Date() }, project: { deletedAt: null } },
      include: invitationInclude,
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map(toInvitation) };
  });

  app.post(
    "/invitations/:id/respond",
    { schema: { params: z.object({ id: z.uuid() }), body: RespondInviteInput } },
    async (req) => {
      const viewer = requireViewer(req);
      const inv = await db.invitation.findUnique({ where: { id: req.params.id }, include: invitationInclude });
      if (!inv || inv.inviteeId !== viewer.id) throw notFound("Invitation not found");
      if (inv.status !== "PENDING") throw conflict("This invitation was already answered");
      if (inv.expiresAt < new Date()) {
        await db.invitation.update({ where: { id: inv.id }, data: { status: "EXPIRED" } });
        throw conflict("This invitation has expired. Ask for a new one.");
      }

      await db.$transaction(async (tx) => {
        // Only a still-pending invitation can be answered: a revoke that lands first wins.
        const { count } = await tx.invitation.updateMany({
          where: { id: inv.id, status: "PENDING", project: { deletedAt: null } },
          data: { status: req.body.accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
        });
        if (count === 0) throw conflict("This invitation is no longer open");
        if (!req.body.accept) return;
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: inv.projectId, userId: viewer.id } },
          create: { projectId: inv.projectId, userId: viewer.id, role: inv.role },
          update: {},
        });
        await tx.joinRequest.updateMany({
          where: { projectId: inv.projectId, userId: viewer.id, status: "PENDING" },
          data: { status: "APPROVED", decidedAt: new Date() },
        });
        await recordActivity(tx, platformEvent(inv.projectId, "member.joined", viewer.id, { role: inv.role, via: "invitation" }));
        await notify(tx, [inv.inviterId], "member.joined", {
          projectName: inv.project.name,
          projectSlug: inv.project.slug,
          ownerUsername: inv.project.owner.username,
          username: viewer.username,
        }, { projectId: inv.projectId });
      });
      // Attach any existing GitHub contribution evidence on this project to the new member.
      await app.deps.jobs.enqueue("project.recompute", { projectId: inv.projectId }, { dedupeId: inv.projectId });
      return { ok: true, project: { ownerUsername: inv.project.owner.username, slug: inv.project.slug } };
    },
  );

  // ── Join requests ───────────────────────────────────────────

  app.post(
    "/projects/:owner/:slug/requests",
    { schema: { params: ProjectParams, body: JoinRequestInput }, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const viewer = requireViewer(req);
      const { project, role } = await resolveProject(db, req.params.owner, req.params.slug, viewer);
      if (role) throw conflict("You are already a member");
      if (!project.openToContributors || project.visibility !== "PUBLIC") {
        throw forbidden("This project is not accepting join requests");
      }
      const pending = await db.joinRequest.findFirst({ where: { projectId: project.id, userId: viewer.id, status: "PENDING" } });
      if (pending) throw conflict("You already have a pending request");

      const created = await db.$transaction(async (tx) => {
        const jr = await tx.joinRequest.create({
          data: { projectId: project.id, userId: viewer.id, message: req.body.message, roleWanted: req.body.roleWanted ?? null },
        });
        const managers = await tx.projectMember.findMany({
          where: { projectId: project.id, role: { in: ["OWNER", "MAINTAINER"] } },
          select: { userId: true },
        });
        await notify(tx, managers.map((m) => m.userId), "request.received", {
          requestId: jr.id,
          projectName: project.name,
          projectSlug: project.slug,
          ownerUsername: project.owner.username,
          username: viewer.username,
          roleWanted: jr.roleWanted,
        }, { projectId: project.id });
        return jr;
      });
      return reply.status(201).send({ id: created.id });
    },
  );

  app.delete("/projects/:owner/:slug/requests/mine", { schema: { params: ProjectParams } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await resolveProject(db, req.params.owner, req.params.slug, viewer);
    await db.joinRequest.updateMany({
      where: { projectId: project.id, userId: viewer.id, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
    return { ok: true };
  });

  app.get("/projects/:owner/:slug/requests", { schema: { params: ProjectParams } }, async (req) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "requests.review");
    const rows = await db.joinRequest.findMany({
      where: { projectId: project.id, status: "PENDING" },
      include: { user: { select: userRefSelect } },
      orderBy: { createdAt: "asc" },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        user: toUserRef(r.user),
        message: r.message,
        roleWanted: r.roleWanted,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.post(
    "/projects/:owner/:slug/requests/:id/decide",
    { schema: { params: ProjectParams.extend({ id: z.uuid() }), body: DecideInput } },
    async (req) => {
      const viewer = requireViewer(req);
      const { project, role } = await authorize(db, req.params, viewer, "requests.review");
      const jr = await db.joinRequest.findFirst({ where: { id: req.params.id, projectId: project.id } });
      if (!jr) throw notFound("Request not found");
      if (jr.status !== "PENDING") throw conflict("This request was already decided");
      const approve = req.body.decision === "APPROVE";
      if (approve && !canAssignRole(role!, req.body.role)) throw forbidden("You can only grant roles below your own");

      await db.$transaction(async (tx) => {
        await tx.joinRequest.update({
          where: { id: jr.id },
          data: { status: approve ? "APPROVED" : "DECLINED", decidedById: viewer.id, decidedAt: new Date() },
        });
        const data = { projectName: project.name, projectSlug: project.slug, ownerUsername: project.owner.username };
        if (approve) {
          await tx.projectMember.upsert({
            where: { projectId_userId: { projectId: project.id, userId: jr.userId } },
            create: { projectId: project.id, userId: jr.userId, role: req.body.role },
            update: {},
          });
          await recordActivity(tx, platformEvent(project.id, "member.joined", jr.userId, { role: req.body.role, via: "request" }));
          await notify(tx, [jr.userId], "request.approved", data, { projectId: project.id });
        } else {
          await notify(tx, [jr.userId], "request.declined", data, { projectId: project.id });
        }
      });
      if (approve) await app.deps.jobs.enqueue("project.recompute", { projectId: project.id }, { dedupeId: project.id });
      return { ok: true };
    },
  );
};
