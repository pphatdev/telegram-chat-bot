import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type AppDatabase = DrizzleD1Database<typeof schema>;

/**
 * Wrap a raw D1 binding in the Drizzle client we use everywhere.
 *
 * Prefer this from code paths that already hold `env` (e.g. the `scheduled()`
 * worker export for cron triggers, where `getCloudflareContext()` isn't
 * available because we're not on a fetch request). Application request
 * handlers should keep using `getDb()` / `getDbAsync()`.
 */
export function buildDb(dbBinding: D1Database): AppDatabase {
  return drizzle(dbBinding, { schema, casing: "snake_case" });
}

/**
 * Returns a Drizzle-wrapped D1 client bound to `env.DB`.
 *
 * Prefer this over the raw binding — it gives typed queries against every
 * table re-exported from `./schema`. If you truly need raw SQL, use
 * `getRawDb()`.
 */
export function getDb(): AppDatabase {
  const { env } = getCloudflareContext();
  return buildDb(env.DB);
}

/**
 * Async variant for contexts where `getCloudflareContext()` cannot run
 * synchronously (e.g. during module init or in edge middleware).
 */
export async function getDbAsync(): Promise<AppDatabase> {
  const { env } = await getCloudflareContext({ async: true });
  return buildDb(env.DB);
}

/**
 * Escape hatch for raw D1 access (migrations, batch statements, low-level
 * prepared queries). Application code should use `getDb()`.
 */
export function getRawDb(): D1Database {
  const { env } = getCloudflareContext();
  return env.DB;
}
