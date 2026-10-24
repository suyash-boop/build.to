import type { Encrypter } from "@bldt/core";
import type { Db } from "@bldt/db";
import type { App, Octokit } from "@bldt/github";
import type { JobClient } from "@bldt/jobs";
import type { Logger } from "pino";

export interface WorkerDeps {
  db: Db;
  github: App;
  jobs: JobClient;
  log: Logger;
  /** Decrypts webhook signing secrets. */
  encrypter: Encrypter;
  /** Public web origin, for links in outbound events. */
  webOrigin: string;
  /** Development only: deliver webhooks to http and private addresses. */
  allowPrivateWebhooks: boolean;
}

/** Installation clients are cached briefly; octokit refreshes the 1-hour token internally. */
const cache = new Map<string, { octokit: Octokit; at: number }>();

export async function installationOctokit(deps: WorkerDeps, installationId: bigint): Promise<Octokit> {
  const key = installationId.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.octokit;
  const octokit = (await deps.github.getInstallationOctokit(Number(installationId))) as unknown as Octokit;
  cache.set(key, { octokit, at: Date.now() });
  return octokit;
}

/** Thrown for conditions that will not improve on retry (repo gone, app uninstalled). */
export class PermanentError extends Error {
  override name = "PermanentError";
}
