import { redirect } from "next/navigation";
import { getMe } from "@/lib/api.server";

export default async function ProjectsEntry() {
  const destination = await getMe() ? "/home" : "/discover";
  redirect(`${process.env.WEB_ORIGIN || "http://localhost:3000"}/projects${destination}`);
}
