import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { toEditorSource } from "@/lib/document";
import { Editor } from "@/app/new/Editor";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditPostPage({ params }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.username) redirect("/onboarding");

  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });

  if (!post) notFound();
  // Editing someone else's post is a 404, not a 403 — don't confirm it exists.
  if (post.userId !== session.user.id) notFound();

  const source = toEditorSource({
    title: post.title,
    published: post.published,
    coverImage: post.coverImage,
    bodyMarkdown: post.bodyMarkdown,
    tags: post.tags.map((pt) => pt.tag.name),
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold">
        {post.published ? "Edit post" : "Edit draft"}
      </h1>
      <Editor postId={post.id} initialSource={source} />
    </main>
  );
}
