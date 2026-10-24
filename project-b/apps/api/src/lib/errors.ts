export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in to continue") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that") => new AppError(403, "forbidden", message);
/** Also used for resources the viewer cannot see, so private projects are not revealed by a 403. */
export const notFound = (message = "Not found") => new AppError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) => new AppError(409, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, "unprocessable", message, details);
