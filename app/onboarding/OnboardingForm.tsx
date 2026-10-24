"use client";

import { useActionState } from "react";
import { claimUsername, type ClaimUsernameState } from "./actions";
import { Button, Input } from "@/components/ui";

export function OnboardingForm({ redirectTo = "/" }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState<
    ClaimUsernameState,
    FormData
  >(claimUsername, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="redirect" value={redirectTo} />
      <div className="flex items-center gap-2">
        <span className="text-secondary">build.to/</span>
        <Input
          name="username"
          placeholder="your_username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={state?.error ? true : undefined}
        />
      </div>
      {state?.error && (
        <p className="text-s text-danger" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" size="l" disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
