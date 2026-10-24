"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Field-level messages from validation errors, keyed by dotted path. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) {
      const field = (this.details as { field?: string } | undefined)?.field;
      return field ? { [field]: this.message } : {};
    }
    return Object.fromEntries(
      (this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]),
    );
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/projects/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let payload: { error?: { code: string; message: string; details?: unknown } } = {};
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    const e = payload.error;
    throw new ApiError(
      res.status,
      e?.code ?? "error",
      e?.message ?? (res.status >= 500 ? "Something went wrong on our side" : "Request failed"),
      e?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => call<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => call<T>("DELETE", path, body),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
