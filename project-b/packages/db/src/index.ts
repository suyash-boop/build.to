import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";

export * from "./generated/client.ts";
export { TECHNOLOGIES, LINGUIST_TO_SLUG, type TechnologyDef } from "./technologies.ts";
export { requireLocalTestDatabase } from "./testing.ts";

export type Db = PrismaClient;

export function createDb(connectionString: string, opts: { max?: number } = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: opts.max ?? 10 });
  return new PrismaClient({ adapter });
}
