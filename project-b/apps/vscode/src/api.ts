/** HTTP client for the bld.t API, through the web origin's /api proxy. No VS Code imports. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiOptions {
  baseUrl: () => string;
  token: () => string | null;
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
  userAgent: string;
}

export class Api {
  constructor(private opts: ApiOptions) {}

  get base() {
    const origin = this.opts.baseUrl().replace(/\/+$/, "");
    if (!origin) return "";
    return origin.endsWith("/projects") ? origin : `${origin}/projects`;
  }

  async request<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
    const f = this.opts.fetchImpl ?? fetch;
    if (!this.base) throw new ApiError(0, "not_configured", "Set your bld.t address first: run bld.t: Sign in.");
    const headers: Record<string, string> = { "user-agent": this.opts.userAgent, accept: "application/json" };
    if (opts.auth !== false) {
      const token = this.opts.token();
      if (!token) throw new ApiError(401, "unauthorized", "Sign in to bld.t first");
      headers.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await f(`${this.base}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ApiError(0, "network", `Cannot reach bld.t at ${this.base}`);
    }
    if (res.status === 204) return undefined as T;
    let json: { error?: { code: string; message: string } } & Record<string, unknown> = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      if (res.status === 401 && opts.auth !== false) this.opts.onUnauthorized();
      throw new ApiError(res.status, json.error?.code ?? "error", json.error?.message ?? `Request failed (${res.status})`);
    }
    return json as T;
  }

  get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body: unknown = {}) {
    return this.request<T>("POST", path, body);
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>("PUT", path, body);
  }
  del<T>(path: string) {
    return this.request<T>("DELETE", path);
  }
}

// ── Device sign-in (RFC 8628) ────────────────────────────────

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface SignedIn {
  accessToken: string;
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
}

/**
 * Poll until the person approves in the browser. Honours the server interval, slow_down and 429, stops
 * on denial, expiry, or cancellation.
 */
export async function pollForToken(
  api: Api,
  code: DeviceCode,
  opts: { cancelled: () => boolean; sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<SignedIn> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + code.expiresIn * 1000;
  let interval = code.interval * 1000;
  for (;;) {
    await sleep(interval);
    if (opts.cancelled()) throw new ApiError(0, "cancelled", "Sign-in cancelled");
    if (now() > deadline) throw new ApiError(0, "expired_token", "The code expired. Start sign-in again.");
    try {
      return await api.request<SignedIn>("POST", "/auth/device/token", { deviceCode: code.deviceCode }, { auth: false });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.code === "authorization_pending" || err.code === "network") continue;
      // A rate limit is the same message as slow_down; failing would throw away an approval in progress.
      if (err.code === "slow_down" || err.status === 429) {
        interval += 5_000;
        continue;
      }
      throw err;
    }
  }
}
