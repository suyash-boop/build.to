import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { OnboardingForm } from "./OnboardingForm";
import { Card } from "@/components/ui";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  // Already onboarded — nothing to do here.
  if (session.user.username) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card className="p-8">
        <h1 className="text-2xl font-bold">Choose a username</h1>
        <p className="mt-1 text-secondary">
          This is your profile address — build.to/your_username. You can&apos;t
          change it after publishing, so pick well.
        </p>
        <div className="mt-6">
          <OnboardingForm />
        </div>
      </Card>
    </main>
  );
}
