import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bots } from "./bots";

/**
 * Persistent token-bucket state backing `src/lib/rate-limit/token-bucket.ts`.
 *
 * `key` is opaque to storage: composed by the caller as e.g. `global`,
 * `chat:<telegramChatId>`, or `broadcast:<id>` so the same table serves every
 * bucket family. `tokensX1000` stores the current bucket level multiplied by
 * 1000 so we can express sub-token fractions using integers only.
 */
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    botId: integer()
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    key: text().notNull(),
    tokensX1000: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [uniqueIndex("rate_limits_bot_key_idx").on(t.botId, t.key)],
);

export type RateLimitRow = typeof rateLimits.$inferSelect;
export type NewRateLimitRow = typeof rateLimits.$inferInsert;
