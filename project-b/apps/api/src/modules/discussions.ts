import {
  CreateDiscussionInput,
  DiscussionReplyInput,
  UpdateDiscussionInput,
  can,
  type DiscussionDetail,
  type DiscussionReplyItem,
  type DiscussionSummary,
  type ErrorContext,
  type SimilarError,
} from "@bldt/contracts";
import { errorFingerprint, errorHeadline, notify, platformEvent, recordActivity } from "@bldt/core";
import type { Db, Prisma, User } from "@bldt/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorize } from "../lib/access.ts";
import { afterCursor, decodeCursor, page } from "../lib/cursor.ts";
import { toUserRef } from "../lib/dto.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { requireViewer } from "../plugins/auth.ts";
import { ProjectParams } from "./projects.ts";

type Tx = Db | Prisma.TransactionClient;
const ThreadParams = ProjectParams.extend({ number: z.coerce.number().int().min(1) });
const ReplyParams = ThreadParams.extend({ replyId: z.uuid() });
const userSelect = { select: { id: true, username: true, displayName: true, avatarUrl: true } } as const;
/** Upper bound per notification fan-out; covers whole teams, protects against runaway lists. */
const NOTIFY_CAP = 500;

const excerpt = (md: string, n = 160) => {
  const plain = md.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~[\]()!-]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > n ? `${plain.slice(0, n - 1)}…` : plain;
};

type SummaryRow = Prisma.DiscussionGetPayload<{ include: { author: typeof userSelect } }>;
function toSummary(d: SummaryRow): DiscussionSummary {
  return {
    id: d.id,
    number: d.number,
    category: d.category,
    title: d.title,
    excerpt: excerpt(d.body),
    author: toUserRef(d.author),
    replyCount: d.replyCount,
    solved: d.answerId != null,
    pinned: d.pinned,
    locked: d.locked,
    errorHeadline: d.errorMessage ? errorHeadline(d.errorMessage).slice(0, 200) : null,
    filePath: d.filePath,
    lastActivityAt: d.lastActivityAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

export async function mentionedUserIds(tx: Tx, projectId: string, body: string): Promise<string[]> {
  const names = [...new Set([...body.matchAll(/(?:^|\s)@([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\b/gi)].map((m) => m[1]!.toLowerCase()))];
  if (names.length === 0) return [];
  const rows = await tx.projectMember.findMany({ where: { projectId, user: { username: { in: names.slice(0, 20) } } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Only link to files on GitHub when the path is a clean repository path. */
function errorContext(d: SummaryRow, repoUrl: string | null): ErrorContext | null {
  if (!d.errorMessage) return null;
  const ref = d.commitSha ?? d.branch;
  const safePath = d.filePath && /^[\w./@+-][\w./@+ -]*$/.test(d.filePath) && !d.filePath.includes("..") ? d.filePath : null;
  return {
    errorMessage: d.errorMessage,
    language: d.language,
    filePath: d.filePath,
    line: d.line,
    codeSnippet: d.codeSnippet,
    branch: d.branch,
    commitSha: d.commitSha,
    fileUrl: repoUrl && ref && safePath ? `${repoUrl}/blob/${encodeURIComponent(ref)}/${safePath.split("/").map(encodeURIComponent).join("/")}${d.line ? `#L${d.line}` : ""}` : null,
    commitUrl: repoUrl && d.commitSha ? `${repoUrl}/commit/${d.commitSha}` : null,
  };
}

export const discussionRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;

  async function thread(projectId: string, number: number) {
    const d = await db.discussion.findUnique({ where: { projectId_number: { projectId, number } }, include: { author: userSelect } });
    if (!d || d.deletedAt) throw notFound("Discussion not found");
    return d;
  }

  /** The same error elsewhere, limited to projects the viewer is a member of. */
  async function similarErrors(viewer: User, fingerprint: string, excludeId?: string): Promise<SimilarError[]> {
    const memberOf = (await db.projectMember.findMany({ where: { userId: viewer.id, project: { deletedAt: null } }, select: { projectId: true } })).map((m) => m.projectId);
    if (!memberOf.length) return [];
    const rows = await db.discussion.findMany({
      where: { errorFingerprint: fingerprint, projectId: { in: memberOf }, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      include: {
        project: { select: { name: true, slug: true, owner: { select: { username: true } } } },
        answer: { include: { author: userSelect } },
      },
      // Solved first: an answer is what the person needs.
      orderBy: [{ solvedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 5,
    });
    return rows.map((r) => ({
      project: { name: r.project.name, slug: r.project.slug, ownerUsername: r.project.owner.username },
      number: r.number,
      title: r.title,
      solved: r.answerId != null,
      createdAt: r.createdAt.toISOString(),
      answer: r.answer && !r.answer.deletedAt ? { excerpt: excerpt(r.answer.body, 280), author: toUserRef(r.answer.author) } : null,
    }));
  }

  app.get(
    "/projects/:owner/:slug/discussions",
    {
      schema: {
        params: ProjectParams,
        querystring: z.object({
          category: z.enum(["GENERAL", "HELP", "IDEAS", "ANNOUNCEMENTS"]).optional(),
          status: z.enum(["open", "solved"]).optional(),
          q: z.string().trim().max(100).optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(25),
        }),
      },
    },
    async (req) => {
      const { project } = await authorize(db, req.params, req.viewer, "tasks.view");
      const { category, status, q } = req.query;
      const where: Prisma.DiscussionWhereInput = {
        projectId: project.id,
        deletedAt: null,
        ...(category ? { category } : {}),
        ...(status === "solved" ? { answerId: { not: null } } : status === "open" ? { answerId: null } : {}),
        ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }, { errorMessage: { contains: q, mode: "insensitive" } }] } : {}),
      };
      const cursor = decodeCursor(req.query.cursor);
      // Pinned threads sit above the feed on the first page and are not repeated in it.
      const [pinned, rows] = await Promise.all([
        cursor || q ? Promise.resolve([]) : db.discussion.findMany({ where: { ...where, pinned: true }, include: { author: userSelect }, orderBy: { lastActivityAt: "desc" }, take: 5 }),
        db.discussion.findMany({
          // Pinned threads are listed above the feed, so they never appear in it, on any page.
          where: { AND: [where, q ? {} : { pinned: false }, afterCursor("lastActivityAt", cursor)] },
          include: { author: userSelect },
          orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
          take: req.query.limit + 1,
        }),
      ]);
      const p = page(rows, req.query.limit, (r) => r.lastActivityAt);
      return { pinned: pinned.map(toSummary), items: p.items.map(toSummary), nextCursor: p.nextCursor };
    },
  );

  /** Before posting: has this error been seen (and solved) already? Used by the form and the editor. */
  app.post("/projects/:owner/:slug/discussions/similar", { schema: { params: ProjectParams, body: z.object({ errorMessage: z.string().max(20_000) }) } }, async (req) => {
    const viewer = requireViewer(req);
    await authorize(db, req.params, viewer, "tasks.view");
    const fp = errorFingerprint(req.body.errorMessage);
    return { fingerprint: fp, items: fp ? await similarErrors(viewer, fp) : [] };
  });

  app.post("/projects/:owner/:slug/discussions", { schema: { params: ProjectParams, body: CreateDiscussionInput }, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const { project } = await authorize(db, req.params, viewer, "comments.create");
    const { category, title, body, error } = req.body;
    if (category === "ANNOUNCEMENTS") await authorize(db, req.params, viewer, "project.update");
    const fp = error ? errorFingerprint(error.errorMessage) : null;

    const created = await db.$transaction(async (tx) => {
      const { discussionCounter } = await tx.project.update({ where: { id: project.id }, data: { discussionCounter: { increment: 1 } }, select: { discussionCounter: true } });
      const d = await tx.discussion.create({
        data: {
          projectId: project.id,
          number: discussionCounter,
          authorId: viewer.id,
          category,
          title,
          body,
          ...(error
            ? {
                errorMessage: error.errorMessage,
                errorFingerprint: fp,
                language: error.language ?? null,
                filePath: error.filePath?.replace(/\\/g, "/") ?? null,
                line: error.line ?? null,
                codeSnippet: error.codeSnippet ?? null,
                branch: error.branch ?? null,
                commitSha: error.commitSha?.toLowerCase() ?? null,
              }
            : {}),
        },
        include: { author: userSelect },
      });
      await recordActivity(tx, platformEvent(project.id, "discussion.created", viewer.id, { number: d.number, title, category }));
      // Help requests and announcements reach the whole team; mentions reach who was named.
      const everyone = category === "HELP" || category === "ANNOUNCEMENTS";
      const recipients = everyone
        ? (await tx.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true }, orderBy: { joinedAt: "asc" }, take: NOTIFY_CAP })).map((m) => m.userId)
        : await mentionedUserIds(tx, project.id, body);
      await notify(tx, recipients, category === "HELP" ? "discussion.help" : category === "ANNOUNCEMENTS" ? "discussion.announcement" : "discussion.mentioned", {
        projectName: project.name,
        projectSlug: project.slug,
        ownerUsername: req.params.owner,
        number: d.number,
        title,
        author: viewer.displayName,
        errorHeadline: error ? errorHeadline(error.errorMessage).slice(0, 160) : null,
      }, { projectId: project.id, exclude: viewer.id, membersOnly: true });
      return d;
    });

    const similar = fp ? await similarErrors(viewer, fp, created.id) : [];
    return reply.status(201).send({ discussion: toSummary(created), similar });
  });

  app.get("/projects/:owner/:slug/discussions/:number", { schema: { params: ThreadParams } }, async (req) => {
    const access = await authorize(db, req.params, req.viewer, "tasks.view");
    const d = await thread(access.project.id, req.params.number);
    const viewer = req.viewer;
    const [replies, repo] = await Promise.all([
      db.discussionReply.findMany({
        where: { discussionId: d.id, deletedAt: null },
        include: { author: userSelect, _count: { select: { votes: true } }, votes: viewer ? { where: { userId: viewer.id }, select: { userId: true } } : false },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
      db.projectRepository.findFirst({ where: { projectId: access.project.id }, orderBy: { isPrimary: "desc" }, select: { repository: { select: { htmlUrl: true } } } }),
    ]);
    const ctx = { role: access.role, visibility: access.project.visibility };
    const canModerate = can("project.update", ctx);
    const isAuthor = viewer?.id === d.authorId;
    const items: DiscussionReplyItem[] = replies.map((r) => ({
      id: r.id,
      author: toUserRef(r.author),
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      helpful: r._count.votes,
      votedByMe: Array.isArray(r.votes) && r.votes.length > 0,
      isAnswer: d.answerId === r.id,
      canEdit: viewer?.id === r.authorId || canModerate,
      mine: viewer?.id === r.authorId,
    }));
    const detail: DiscussionDetail = {
      ...toSummary(d),
      body: d.body,
      error: errorContext(d, repo?.repository.htmlUrl ?? null),
      answerId: d.answerId,
      replies: items,
      similar: viewer && d.errorFingerprint ? await similarErrors(viewer, d.errorFingerprint, d.id) : [],
      viewer: {
        canReply: can("comments.create", ctx) && (!d.locked || canModerate),
        canEdit: isAuthor || canModerate,
        canModerate,
        canAnswer: d.category === "HELP" && (isAuthor || canModerate),
      },
    };
    return detail;
  });

  app.patch("/projects/:owner/:slug/discussions/:number", { schema: { params: ThreadParams, body: UpdateDiscussionInput } }, async (req) => {
    const viewer = requireViewer(req);
    const access = await authorize(db, req.params, viewer, "tasks.view");
    const d = await thread(access.project.id, req.params.number);
    const canModerate = can("project.update", { role: access.role, visibility: access.project.visibility });
    const moderating = req.body.pinned !== undefined || req.body.locked !== undefined || req.body.category === "ANNOUNCEMENTS";
    if ((moderating && !canModerate) || (d.authorId !== viewer.id && !canModerate)) throw forbidden();
    if (req.body.category && req.body.category !== "HELP" && d.errorMessage) throw badRequest("A thread about an error stays in Help");
    await db.discussion.update({ where: { id: d.id }, data: req.body });
    return { ok: true };
  });

  app.delete("/projects/:owner/:slug/discussions/:number", { schema: { params: ThreadParams } }, async (req) => {
    const viewer = requireViewer(req);
    const access = await authorize(db, req.params, viewer, "tasks.view");
    const d = await thread(access.project.id, req.params.number);
    if (d.authorId !== viewer.id && !can("project.update", { role: access.role, visibility: access.project.visibility })) throw forbidden();
    await db.discussion.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    return { ok: true };
  });

  app.post("/projects/:owner/:slug/discussions/:number/replies", { schema: { params: ThreadParams, body: DiscussionReplyInput }, config: { rateLimit: { max: 120, timeWindow: "1 hour" } } }, async (req, reply) => {
    const viewer = requireViewer(req);
    const access = await authorize(db, req.params, viewer, "comments.create");
    const d = await thread(access.project.id, req.params.number);
    if (d.locked && !can("project.update", { role: access.role, visibility: access.project.visibility })) throw forbidden("This discussion is locked");
    const r = await db.$transaction(async (tx) => {
      const created = await tx.discussionReply.create({ data: { discussionId: d.id, projectId: access.project.id, authorId: viewer.id, body: req.body.body } });
      await tx.discussion.update({ where: { id: d.id }, data: { replyCount: { increment: 1 }, lastActivityAt: new Date() } });
      // The thread's author, everyone who replied, and anyone mentioned.
      const participants = await tx.discussionReply.findMany({ where: { discussionId: d.id, deletedAt: null }, distinct: ["authorId"], select: { authorId: true }, orderBy: { authorId: "asc" }, take: NOTIFY_CAP });
      const mentioned = await mentionedUserIds(tx, access.project.id, req.body.body);
      await notify(tx, [d.authorId, ...participants.map((p) => p.authorId), ...mentioned], "discussion.replied", {
        projectName: access.project.name,
        projectSlug: access.project.slug,
        ownerUsername: req.params.owner,
        number: d.number,
        title: d.title,
        author: viewer.displayName,
        excerpt: excerpt(req.body.body, 140),
      }, { projectId: access.project.id, exclude: viewer.id, membersOnly: true });
      return created;
    });
    return reply.status(201).send({ id: r.id });
  });

  app.patch("/projects/:owner/:slug/discussions/:number/replies/:replyId", { schema: { params: ReplyParams, body: DiscussionReplyInput } }, async (req) => {
    const viewer = requireViewer(req);
    const access = await authorize(db, req.params, viewer, "tasks.view");
    const d = await thread(access.project.id, req.params.number);
    const r = await db.discussionReply.findFirst({ where: { id: req.params.replyId, discussionId: d.id, deletedAt: null } });
    if (!r) throw notFound("Reply not found");
    if (r.authorId !== viewer.id) throw forbidden("You can only edit your own replies");
    await db.discussionReply.update({ where: { id: r.id }, data: { body: req.body.body, editedAt: new Date() } });
    return { ok: true };
  });

  app.delete("/projects/:owner/:slug/discussions/:number/replies/:replyId", { schema: { params: ReplyParams } }, async (req) => {
    const viewer = requireViewer(req);
    const access = await authorize(db, req.params, viewer, "tasks.view");
    const d = await thread(access.project.id, req.params.number);
    const r = await db.discussionReply.findFirst({ where: { id: req.params.replyId, discussionId: d.id, deletedAt: null } });
    if (!r) throw notFound("Reply not found");
    if (r.authorId !== viewer.id && !can("project.update", { role: access.role, visibility: access.project.visibility })) throw forbidden();
    await db.$transaction(async (tx) => {
      // Two concurrent deletes: only the one that actually soft-deletes adjusts the count.
      const { count } = await tx.discussionReply.updateMany({ where: { id: r.id, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) return;
      // A deleted answer un-solves the thread.
      await tx.discussion.update({ where: { id: d.id }, data: { replyCount: { decrement: 1 }, ...(d.answerId === r.id ? { answerId: null, solvedAt: null } : {}) } });
    });
    return { ok: true };
  });

  app.post("/projects/:owner/:slug/discussions/:number/answer", { schema: { params: ThreadParams, body: z.object({ replyId: z.uuid().nullable() }) } }, async (req) => {
    const viewer = requireViewer(req);
    const access = await authorize(db, req.params, viewer, "tasks.view");
    const d = await thread(access.project.id, req.params.number);
    if (d.category !== "HELP") throw badRequest("Only help threads have answers");
    if (d.authorId !== viewer.id && !can("project.update", { role: access.role, visibility: access.project.visibility })) throw forbidden("Only the person who asked, or a maintainer, can choose the answer");
    if (req.body.replyId === null) {
      await db.discussion.update({ where: { id: d.id }, data: { answerId: null, solvedAt: null } });
      return { ok: true };
    }
    const r = await db.discussionReply.findFirst({ where: { id: req.body.replyId, discussionId: d.id, deletedAt: null } });
    if (!r) throw notFound("Reply not found");
    await db.$transaction(async (tx) => {
      await tx.discussion.update({ where: { id: d.id }, data: { answerId: r.id, solvedAt: new Date() } });
      if (!d.answerId) await recordActivity(tx, platformEvent(access.project.id, "discussion.solved", viewer.id, { number: d.number, title: d.title }));
      await notify(tx, [r.authorId], "discussion.answered", {
        projectName: access.project.name,
        projectSlug: access.project.slug,
        ownerUsername: req.params.owner,
        number: d.number,
        title: d.title,
      }, { projectId: access.project.id, exclude: viewer.id, membersOnly: true });
    });
    return { ok: true };
  });

  app.post("/projects/:owner/:slug/discussions/:number/replies/:replyId/vote", { schema: { params: ReplyParams } }, async (req) => {
    const viewer = requireViewer(req);
    const access = await authorize(db, req.params, viewer, "tasks.view");
    const d = await thread(access.project.id, req.params.number);
    const r = await db.discussionReply.findFirst({ where: { id: req.params.replyId, discussionId: d.id, deletedAt: null } });
    if (!r) throw notFound("Reply not found");
    if (r.authorId === viewer.id) throw badRequest("You cannot mark your own reply as helpful");
    const key = { replyId_userId: { replyId: r.id, userId: viewer.id } };
    const existing = await db.discussionVote.findUnique({ where: key });
    if (existing) await db.discussionVote.delete({ where: key });
    else await db.discussionVote.create({ data: { replyId: r.id, userId: viewer.id } });
    return { voted: !existing, helpful: await db.discussionVote.count({ where: { replyId: r.id } }) };
  });
};

