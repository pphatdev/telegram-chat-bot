import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type AppDatabase = DrizzleD1Database<typeof schema>;

/**
 * Wrap a raw D1 binding in the Drizzle client used everywhere.
 *
 * Runtime-agnostic: callers pass their own `env.DB`. This keeps the module
 * free of OpenNext / Next.js dependencies so the plain `bot-api` Worker can
 * import it directly.
 *
 * Code running under Next.js should prefer the context helpers in
 * `apps/web/src/db/context.ts` (`getDb`, `getDbAsync`, `getRawDb`), which
 * resolve `env` from `getCloudflareContext()` and delegate here.
 */
export function buildDb(dbBinding: D1Database): AppDatabase {
  return drizzle(dbBinding, { schema, casing: "snake_case" });
}
