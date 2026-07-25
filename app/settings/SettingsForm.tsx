"use client";

import { useActionState } from "react";
import { updateSettings, type SettingsState } from "./actions";
import { Button, Card, Input, Textarea } from "@/components/ui";

type Values = Record<string, string | boolean | null>;

export interface SettingsFormProps {
  values: Values;
}

function Field({
  label,
  name,
  hint,
  defaultValue,
  textarea = false,
  maxLength,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  hint?: string;
  defaultValue?: string | null;
  textarea?: boolean;
  maxLength?: number;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-s font-medium text-body">{label}</span>
      {hint && <span className="mt-0.5 block text-s text-secondary">{hint}</span>}
      <div className="mt-1">
        {textarea ? (
          <Textarea
            name={name}
            defaultValue={defaultValue ?? ""}
            maxLength={maxLength}
            placeholder={placeholder}
            rows={2}
          />
        ) : (
          <Input
            name={name}
            type={type}
            defaultValue={defaultValue ?? ""}
            maxLength={maxLength}
            placeholder={placeholder}
          />
        )}
      </div>
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-l font-bold">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  );
}

export function SettingsForm({ values }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    null,
  );

  const str = (k: string) => (values[k] as string | null) ?? "";

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Section title="User">
        <Field label="Display name" name="name" defaultValue={str("name")} maxLength={100} />
        <Field
          label="Profile image URL"
          name="profileImage"
          hint="A link to an image — build.to does not host uploads."
          defaultValue={str("profileImage")}
          placeholder="https://…"
          maxLength={500}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="displayEmailOnProfile"
            defaultChecked={values.displayEmailOnProfile === true}
            className="size-4"
          />
          <span className="text-s text-body">Display email on profile</span>
        </label>
      </Section>

      <Section title="Basic">
        <Field label="Bio" name="bio" hint="Max 200 characters." textarea defaultValue={str("bio")} maxLength={200} />
        <Field label="Location" name="location" defaultValue={str("location")} maxLength={100} />
        <Field label="Website URL" name="websiteUrl" defaultValue={str("websiteUrl")} placeholder="https://yoursite.com" maxLength={200} />
        <Field label="Profile banner image URL" name="profileBgImage" hint="Optional — shows behind the profile header instead of the brand colour." defaultValue={str("profileBgImage")} placeholder="https://…" maxLength={500} />
      </Section>

      <Section title="Coding">
        <Field label="Skills / languages" name="skills" hint="What tools and languages are you most experienced with?" textarea defaultValue={str("skills")} maxLength={200} />
        <Field label="Currently learning" name="currentlyLearning" textarea defaultValue={str("currentlyLearning")} maxLength={200} />
        <Field label="Available for" name="availableFor" hint="Collaborations, mentoring, freelance…" textarea defaultValue={str("availableFor")} maxLength={200} />
        <Field label="Currently hacking on" name="currentlyHackingOn" textarea defaultValue={str("currentlyHackingOn")} maxLength={200} />
      </Section>

      <Section title="Personal">
        <Field label="Pronouns" name="pronouns" placeholder="e.g. they/them" defaultValue={str("pronouns")} maxLength={100} />
      </Section>

      <Section title="Work">
        <Field label="Work" name="work" placeholder="What do you do?" defaultValue={str("work")} maxLength={100} />
        <Field label="Education" name="education" placeholder="Where did you study?" defaultValue={str("education")} maxLength={100} />
      </Section>

      <Section title="Social links">
        <Field label="GitHub username" name="githubUsername" defaultValue={str("githubUsername")} maxLength={100} />
        <Field label="Twitter username" name="twitterUsername" defaultValue={str("twitterUsername")} maxLength={100} />
        <Field label="Mastodon" name="mastodonUsername" placeholder="@user@instance.social" defaultValue={str("mastodonUsername")} maxLength={200} />
        <Field label="Instagram username" name="instagramUsername" defaultValue={str("instagramUsername")} maxLength={100} />
        <Field label="Facebook username" name="facebookUsername" defaultValue={str("facebookUsername")} maxLength={100} />
        <Field label="Twitch username" name="twitchUsername" defaultValue={str("twitchUsername")} maxLength={100} />
        <Field label="YouTube URL" name="youtubeUrl" defaultValue={str("youtubeUrl")} placeholder="https://youtube.com/@…" maxLength={200} />
      </Section>

      <Section title="Branding">
        <label className="block">
          <span className="text-s font-medium text-body">Brand colour</span>
          <span className="mt-0.5 block text-s text-secondary">
            Used for your profile banner.
          </span>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="color"
              name="brandColor"
              defaultValue={str("brandColor") || "#000000"}
              className="h-9 w-16 cursor-pointer rounded border border-border bg-body-bg"
            />
          </div>
        </label>
      </Section>

      {state && !state.ok && (
        <p role="alert" className="text-s text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-s text-success">
          Saved.
        </p>
      )}

      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" size="l" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
