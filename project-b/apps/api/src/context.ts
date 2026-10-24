import type { Ai } from "@bldt/ai";
import type { KeyRing } from "@bldt/core";
import type { Db, User } from "@bldt/db";
import type { App } from "@bldt/github";
import type { JobClient, Redis } from "@bldt/jobs";
import type { Env } from "./env.ts";
import type { Encrypter } from "./lib/crypto.ts";
import type { RealtimeHub } from "./lib/realtime.ts";

export interface Deps {
  env: Env;
  db: Db;
  redis: Redis;
  jobs: JobClient;
  github: App;
  encrypter: Encrypter;
  /** Null when ANTHROPIC_API_KEY is not configured. */
  ai: Ai | null;
  /** Null when live updates are disabled (tests, or REALTIME=off). */
  realtime: RealtimeHub | null;
  /** Null when WORK_RECORD_SIGNING_KEY is not configured. */
  workKeys: KeyRing | null;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: Deps;
  }
  interface FastifyRequest {
    viewer: User | null;
    sessionId: string | null;
    /** BROWSER (cookie) or DEVICE (editor bearer token); null when signed out. */
    sessionKind: "BROWSER" | "DEVICE" | null;
  }
}
