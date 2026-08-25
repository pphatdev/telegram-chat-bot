import { getCloudflareContext } from "@opennextjs/cloudflare";
import { buildDb, type AppDatabase } from "@telegram-bot/shared/db";

/**
 * OpenNext-bound helpers to obtain a Drizzle client from
 * `getCloudflareContext()`.
 *
 * These wrap `buildDb()` from `@telegram-bot/shared/db` with the Next.js /
 * OpenNext request-context lookup. Server actions, route handlers, and RSC
 * code should use these. Code running outside a fetch request (e.g. the
 * `scheduled()` cron export in `apps/bot-api`) should call `buildDb(env.DB)`
 * directly instead.
 */

export type { AppDatabase };

export function getDb(): AppDatabase {
  const { env } = getCloudflareContext();
  return buildDb(env.DB);
}

export async function getDbAsync(): Promise<AppDatabase> {
  const { env } = await getCloudflareContext({ async: true });
  return buildDb(env.DB);
}

export function getRawDb(): D1Database {
  const { env } = getCloudflareContext();
  return env.DB;
}
