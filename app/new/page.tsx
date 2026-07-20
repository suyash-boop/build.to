import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { Editor } from "./Editor";

export default async function NewPostPage() {
  // proxy.ts does an optimistic cookie check; this is the authoritative one.
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.username) redirect("/onboarding");

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold">Write a post</h1>
      <Editor />
    </main>
  );
}
