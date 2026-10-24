import { badRequest } from "./errors.ts";

/** Opaque keyset cursor over (timestamp desc, id desc). Stable under concurrent inserts, unlike offsets. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime()) || !id) throw badRequest("Invalid cursor");
  return { at: date, id };
}

/** Prisma where-clause for rows strictly after the cursor in (field desc, id desc) order. */
export function afterCursor<F extends string>(field: F, c: { at: Date; id: string } | null) {
  if (!c) return {};
  return { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] } as Record<string, unknown>;
}

export function page<T extends { id: string }>(rows: T[], limit: number, at: (row: T) => Date) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(at(last), last.id) : null };
}
