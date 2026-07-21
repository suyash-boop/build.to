// Shared comment constants. Kept out of the "use server" actions module, which
// may only export async functions.

export const MAX_DEPTH = 3; // PRD §4.5
export const TOMBSTONE = "[deleted]";

export type CommentResult = { ok: true } | { ok: false; error: string };
