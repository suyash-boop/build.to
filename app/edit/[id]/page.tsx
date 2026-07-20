import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { toEditorSource } from "@/lib/document";
import { Editor } from "@/app/new/Editor";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}

export default async function EditPostPage({ params, searchParams }: PageProps) {
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
    coverImage: post.coverImage,
    bodyMarkdown: post.bodyMarkdown,
    tags: post.tags.map((pt) => pt.tag.name),
  });

  const { saved } = await searchParams;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">
          {post.published ? "Edit post" : "Edit draft"}
        </h1>
        {post.published ? (
          <Link
            href={`/${session.user.username}/${post.slug}`}
            className="text-s text-secondary underline hover:text-body"
          >
            View post
          </Link>
        ) : (
          <span className="rounded border border-warning px-2 py-1 text-s text-warning">
            Draft — not visible to anyone else
          </span>
        )}
        {saved && (
          <span className="text-s text-success">Draft saved</span>
        )}
      </div>
      <Editor postId={post.id} initialSource={source} />
    </main>
  );
}
