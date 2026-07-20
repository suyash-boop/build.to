import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";

// OAuth-only auth (Google + GitHub) — see PRD §5.1 override. Email/password is
// intentionally NOT enabled. `username` is collected after first sign-in at
// /onboarding, so it's an optional additional field here (null until then).
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },

  user: {
    additionalFields: {
      // Populated at /onboarding after first sign-in, hence optional here.
      username: { type: "string", required: false, input: false },
      profileImage: { type: "string", required: false, input: false },
      profileBgImage: { type: "string", required: false, input: false },
      bio: { type: "string", required: false, input: false },
      location: { type: "string", required: false, input: false },
      websiteUrl: { type: "string", required: false, input: false },
      work: { type: "string", required: false, input: false },
      education: { type: "string", required: false, input: false },
      skills: { type: "string", required: false, input: false },
      brandColor: { type: "string", required: false, input: false },
      postsCount: { type: "number", required: false, input: false },
      displayEmailOnProfile: { type: "boolean", required: false, input: false },
      pronouns: { type: "string", required: false, input: false },
      currentlyLearning: { type: "string", required: false, input: false },
      availableFor: { type: "string", required: false, input: false },
      currentlyHackingOn: { type: "string", required: false, input: false },
      githubUsername: { type: "string", required: false, input: false },
      twitterUsername: { type: "string", required: false, input: false },
      mastodonUsername: { type: "string", required: false, input: false },
      facebookUsername: { type: "string", required: false, input: false },
      instagramUsername: { type: "string", required: false, input: false },
      youtubeUrl: { type: "string", required: false, input: false },
      twitchUsername: { type: "string", required: false, input: false },
    },
  },

  // Must be the last plugin — lets server actions/route handlers set auth cookies.
  plugins: [nextCookies()],
});
