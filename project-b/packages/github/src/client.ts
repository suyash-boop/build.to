import { App, Octokit } from "octokit";

export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
  slug: string;
}

/** Per request: GitHub occasionally holds connections open, and a stuck call would pin a worker slot. */
const REQUEST_TIMEOUT_MS = 30_000;

const timedFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

const TimedOctokit = Octokit.defaults({ request: { fetch: timedFetch } });

/**
 * GitHub App, not an OAuth App: installation tokens are short-lived and scoped to the repos
 * the user selected, and webhooks arrive centrally without creating hooks per repository.
 */
export function createGithubApp(cfg: GithubAppConfig): App {
  if (!cfg.appId || !cfg.privateKey || !cfg.clientId || !cfg.clientSecret || !cfg.webhookSecret || !cfg.slug) {
    // Manual projects do not require GitHub credentials. A disabled integration
    // fails explicitly when invoked; it must never pretend to have synced data.
    return new Proxy({} as App, {
      get() { throw Object.assign(new Error("GitHub App is not configured. Add the GITHUB_APP_* settings to enable repository sync."), { statusCode: 503 }); },
    });
  }
  return new App({
    appId: cfg.appId,
    // Env files commonly store PEM keys with escaped newlines.
    privateKey: cfg.privateKey.includes("\\n") ? cfg.privateKey.replace(/\\n/g, "\n") : cfg.privateKey,
    webhooks: { secret: cfg.webhookSecret },
    oauth: { clientId: cfg.clientId, clientSecret: cfg.clientSecret },
    Octokit: TimedOctokit,
  });
}

export function userOctokit(accessToken: string): Octokit {
  return new TimedOctokit({ auth: accessToken, userAgent: "bldt" });
}

export function installUrl(slug: string, state?: string): string {
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export type { Octokit, App };
