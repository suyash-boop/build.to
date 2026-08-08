import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { renderMarkdown, readingTime, excerpt } from "../lib/markdown";
import { generateSlug } from "../lib/slug";
import { seedUsers, seedPosts } from "./seed-data";
import type { ReactionCategory } from "@prisma/client";

// Standalone client — the seed runs outside Next.js, so it wires its own
// adapter rather than importing lib/prisma (which assumes the app runtime).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TAG_COLORS = [
  "#4f46e5",
  "#0e7490",
  "#059669",
  "#b45309",
  "#be185d",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
];

const REACTION_CATEGORIES: ReactionCategory[] = [
  "LIKE",
  "UNICORN",
  "FIRE",
  "EXPLODING_HEAD",
];

// Deterministic-ish PRNG so a reseed produces the same believable spread.
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function chance(p: number) {
  return rand() < p;
}

const COMMENT_BODIES = [
  "This is exactly the mental model I was missing. Thanks for writing it up.",
  "Great post. One thing I'd add: this bites you hardest under concurrency.",
  "I disagree slightly — in my experience the tradeoff goes the other way at scale.",
  "Saving this. We hit this exact issue last quarter and flailed for days.",
  "Do you have benchmarks? Curious how much this actually moves in practice.",
  "Underrated point. Most people skip straight to the fancy solution.",
  "Clear and to the point. More posts like this please.",
  "Been burned by this. Learned it the hard way so I appreciate the warning.",
];

const REPLY_BODIES = [
  "Good question — yes, and the numbers held up across three services.",
  "Fair. It depends a lot on your write pattern, agreed.",
  "That matches what we saw too.",
  "Right, that's the edge case the post glosses over a bit.",
];

async function clear() {
  // Order matters for FKs, though most cascade. Only wipe seeded-style data:
  // clearing everything is fine for a demo DB.
  await prisma.notification.deleteMany();
  await prisma.reaction.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.postTag.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  // Keep real (OAuth) users; only remove seeded demo users by their emails.
  await prisma.user.deleteMany({
    where: { email: { in: seedUsers.map((u) => u.email) } },
  });
}

async function main() {
  console.log("clearing previous seed data…");
  await clear();

  // ── Users ─────────────────────────────────────────────────────────────────
  console.log("creating users…");
  const userIds = new Map<string, string>();
  for (const u of seedUsers) {
    const created = await prisma.user.create({
      data: {
        id: `seed_${u.username}`,
        name: u.name,
        email: u.email,
        emailVerified: true,
        username: u.username,
        bio: u.bio,
        location: u.location,
        brandColor: u.brandColor,
        work: u.work,
        skills: u.skills,
        githubUsername: u.githubUsername,
        pronouns: u.pronouns,
      },
    });
    userIds.set(u.username, created.id);
  }

  // ── Tags ──────────────────────────────────────────────────────────────────
  console.log("creating tags…");
  const tagNames = [...new Set(seedPosts.flatMap((p) => p.tags))];
  const tagIds = new Map<string, string>();
  for (const name of tagNames) {
    const tag = await prisma.tag.create({
      data: { name, bgColorHex: pick(TAG_COLORS) },
    });
    tagIds.set(name, tag.id);
  }

  // ── Posts (rendered through the real pipeline) ─────────────────────────────
  console.log("creating posts…");
  const postIds: { id: string; authorId: string }[] = [];
  // Spread publish dates over the last few weeks.
  let daysAgo = seedPosts.length * 2;
  for (const p of seedPosts) {
    const authorId = userIds.get(p.authorUsername)!;
    const html = await renderMarkdown(p.body);
    const publishedAt = new Date(Date.now() - daysAgo * 86400000);
    daysAgo -= 2;

    const post = await prisma.post.create({
      data: {
        userId: authorId,
        title: p.title,
        slug: generateSlug(p.title),
        bodyMarkdown: p.body,
        processedHtml: html,
        processingState: "READY",
        description: excerpt(p.body),
        readingTime: readingTime(p.body),
        published: true,
        publishedAt,
        createdAt: publishedAt,
      },
    });
    postIds.push({ id: post.id, authorId });

    for (const tagName of p.tags) {
      await prisma.postTag.create({
        data: { postId: post.id, tagId: tagIds.get(tagName)! },
      });
      await prisma.tag.update({
        where: { id: tagIds.get(tagName)! },
        data: { postsCount: { increment: 1 } },
      });
    }
    await prisma.user.update({
      where: { id: authorId },
      data: { postsCount: { increment: 1 } },
    });
  }

  const allUserIds = [...userIds.values()];

  // ── Comments (threaded, depths 1–3) ────────────────────────────────────────
  console.log("creating comments…");
  for (const post of postIds) {
    const topLevelCount = 1 + Math.floor(rand() * 4);
    let commentsAdded = 0;

    for (let i = 0; i < topLevelCount; i++) {
      const commenter = pick(allUserIds);
      const body = pick(COMMENT_BODIES);
      const top = await prisma.comment.create({
        data: {
          postId: post.id,
          userId: commenter,
          bodyMarkdown: body,
          processedHtml: await renderMarkdown(body),
          depth: 0,
        },
      });
      commentsAdded++;

      // Some top-level comments get a reply, occasionally a reply-to-reply.
      if (chance(0.6)) {
        const replyBody = pick(REPLY_BODIES);
        const reply = await prisma.comment.create({
          data: {
            postId: post.id,
            userId: pick(allUserIds),
            parentId: top.id,
            bodyMarkdown: replyBody,
            processedHtml: await renderMarkdown(replyBody),
            depth: 1,
          },
        });
        commentsAdded++;

        if (chance(0.3)) {
          const deepBody = pick(REPLY_BODIES);
          await prisma.comment.create({
            data: {
              postId: post.id,
              userId: pick(allUserIds),
              parentId: reply.id,
              bodyMarkdown: deepBody,
              processedHtml: await renderMarkdown(deepBody),
              depth: 2,
            },
          });
          commentsAdded++;
        }
      }
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { commentsCount: commentsAdded },
    });
  }

  // ── Reactions ───────────────────────────────────────────────────────────────
  console.log("creating reactions…");
  for (const post of postIds) {
    let reactionCount = 0;
    for (const userId of allUserIds) {
      if (userId === post.authorId) continue; // no self-reactions
      // Each user has a chance to leave one or two reactions per post.
      for (const category of REACTION_CATEGORIES) {
        if (chance(0.22)) {
          await prisma.reaction.create({
            data: {
              userId,
              reactableId: post.id,
              reactableType: "POST",
              category,
            },
          });
          reactionCount++;
        }
      }
      if (chance(0.3)) {
        await prisma.reaction.create({
          data: {
            userId,
            reactableId: post.id,
            reactableType: "POST",
            category: "BOOKMARK",
          },
        });
        // BOOKMARK doesn't count toward the visible reaction total.
      }
    }
    await prisma.post.update({
      where: { id: post.id },
      data: { reactionsCount: reactionCount },
    });
  }

  // ── Follows (users follow users and tags) ──────────────────────────────────
  console.log("creating follows…");
  for (const follower of allUserIds) {
    for (const target of allUserIds) {
      if (follower !== target && chance(0.35)) {
        await prisma.follow.create({
          data: {
            followerId: follower,
            followableId: target,
            followableType: "USER",
          },
        });
      }
    }
    for (const [, tagId] of tagIds) {
      if (chance(0.25)) {
        await prisma.follow.create({
          data: {
            followerId: follower,
            followableId: tagId,
            followableType: "TAG",
          },
        });
      }
    }
  }

  const counts = {
    users: seedUsers.length,
    posts: postIds.length,
    tags: tagNames.length,
    comments: await prisma.comment.count(),
    reactions: await prisma.reaction.count(),
    follows: await prisma.follow.count(),
  };
  console.log("seeded:", counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
