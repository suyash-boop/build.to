import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: "Drafts" };

export default async function DraftsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.username) redirect("/onboarding");

  const drafts = await prisma.post.findMany({
    where: { userId: session.user.id, published: false },
    orderBy: { updatedAt: "desc" },
    include: { tags: { include: { tag: true } } },
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold">Drafts</h1>

      {drafts.length === 0 ? (
        <EmptyState
          title="No drafts yet"
          description="Posts you save without publishing show up here."
          action={
            <Link
              href="/new"
              className="inline-flex h-8 items-center justify-center rounded bg-brand px-3 text-s font-medium text-white transition-colors hover:bg-brand-hover"
            >
              Write a post
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <Card hover className="p-4">
                <Link href={`/edit/${draft.id}`} className="block">
                  <p className="text-l font-medium text-body">
                    {draft.title || "Untitled draft"}
                  </p>
                  {draft.description && (
                    <p className="mt-1 line-clamp-2 text-secondary">
                      {draft.description}
                    </p>
                  )}
                  <p className="mt-2 text-s text-secondary">
                    Edited{" "}
                    <time dateTime={draft.updatedAt.toISOString()}>
                      {draft.updatedAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </time>
                    {draft.tags.length > 0 &&
                      ` · ${draft.tags.map((pt) => `#${pt.tag.name}`).join(" ")}`}
                  </p>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
