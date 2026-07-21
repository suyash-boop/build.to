import { prisma } from "@/lib/prisma";

export interface CommentNode {
  id: string;
  processedHtml: string;
  bodyMarkdown: string;
  depth: number;
  createdAt: Date;
  author: { name: string; username: string | null; image: string | null };
  isAuthor: boolean;
  replies: CommentNode[];
}

/**
 * Fetch a post's entire comment set in ONE query and assemble the tree in
 * memory (PRD §4.5) — recursive per-level queries would be N+1 on a thread.
 * Sorted createdAt ASC within each level (§5.6).
 */
export async function getCommentTree(
  postId: string,
  viewerId?: string,
): Promise<CommentNode[]> {
  const rows = await prisma.comment.findMany({
    where: { postId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      parentId: true,
      processedHtml: true,
      bodyMarkdown: true,
      depth: true,
      createdAt: true,
      userId: true,
      user: {
        select: {
          name: true,
          username: true,
          profileImage: true,
          image: true,
        },
      },
    },
  });

  const nodes = new Map<string, CommentNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      processedHtml: row.processedHtml,
      bodyMarkdown: row.bodyMarkdown,
      depth: row.depth,
      createdAt: row.createdAt,
      author: {
        name: row.user.name,
        username: row.user.username,
        image: row.user.profileImage ?? row.user.image,
      },
      isAuthor: viewerId === row.userId,
      replies: [],
    });
  }

  const roots: CommentNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }

  return roots;
}
