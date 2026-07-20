"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, Card } from "@/components/ui";

export default function LoginPage() {
  const [loading, setLoading] = useState<"google" | "github" | null>(null);

  async function signInWith(provider: "google" | "github") {
    setLoading(provider);
    // After sign-in, land on /onboarding; it forwards to / once a username exists.
    await authClient.signIn.social({
      provider,
      callbackURL: "/onboarding",
    });
    // signIn.social redirects the browser, so we don't reset loading here.
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card className="p-8">
        <h1 className="text-2xl font-bold">Welcome to build.to</h1>
        <p className="mt-1 text-secondary">
          Sign in to write and react to posts.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Button
            variant="secondary"
            size="l"
            disabled={loading !== null}
            onClick={() => signInWith("google")}
          >
            {loading === "google" ? "Redirecting…" : "Continue with Google"}
          </Button>
          <Button
            variant="secondary"
            size="l"
            disabled={loading !== null}
            onClick={() => signInWith("github")}
          >
            {loading === "github" ? "Redirecting…" : "Continue with GitHub"}
          </Button>
        </div>
      </Card>
    </main>
  );
}
