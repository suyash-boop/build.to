import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const destination = `/projects${safeNext(typeof next === "string" ? next : undefined)}`;
  redirect(`${process.env.WEB_ORIGIN || "http://localhost:3000"}/login?redirect=${encodeURIComponent(destination)}`);
}
