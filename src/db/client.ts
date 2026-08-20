import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type AppDatabase = DrizzleD1Database<typeof schema>;

/**
 * Returns a Drizzle-wrapped D1 client bound to `env.DB`.
 *
 * Prefer this over the raw binding — it gives typed queries against every
 * table re-exported from `./schema`. If you truly need raw SQL, use
 * `getRawDb()`.
 */
export function getDb(): AppDatabase {
  const { env } = getCloudflareContext();
  return drizzle(env.DB, { schema, casing: "snake_case" });
}

/**
 * Async variant for contexts where `getCloudflareContext()` cannot run
 * synchronously (e.g. during module init or in edge middleware).
 */
export async function getDbAsync(): Promise<AppDatabase> {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema, casing: "snake_case" });
}

/**
 * Escape hatch for raw D1 access (migrations, batch statements, low-level
 * prepared queries). Application code should use `getDb()`.
 */
export function getRawDb(): D1Database {
  const { env } = getCloudflareContext();
  return env.DB;
}
