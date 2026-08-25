import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Token-bucket state for buckets that are NOT scoped to a bot.
 *
 * The primary use-case is the un-authenticated media proxy
 * (`/api/media/[...key]`), keyed on the caller IP to blunt enumeration
 * attempts even though the R2 keys themselves are opaque UUIDs.
 *
 * Same shape as `rate_limits` but with a nullable-owner design: `key`
 * uniquely identifies the bucket without any bot foreign key. Kept as a
 * separate table so the existing bot-scoped `rate_limits` table can keep
 * its `NOT NULL` FK to `bots` for cascade-on-delete semantics.
 */
export const anonRateLimits = sqliteTable(
  "anon_rate_limits",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    key: text().notNull(),
    tokensX1000: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [uniqueIndex("anon_rate_limits_key_idx").on(t.key)],
);

export type AnonRateLimitRow = typeof anonRateLimits.$inferSelect;
export type NewAnonRateLimitRow = typeof anonRateLimits.$inferInsert;
