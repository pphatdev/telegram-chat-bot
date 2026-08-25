import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./users";

/**
 * Telegram Bots registered by an operator.
 *
 * `encryptedToken` holds the Telegram Bot API token wrapped with AES-GCM-256
 * via `src/lib/crypto/aes-gcm.ts`. It is never stored, logged, or returned in
 * plaintext.
 *
 * `lastUpdateId` persists the getUpdates cursor for long-polling so restarts
 * don't re-process the same batch.
 */
export const bots = sqliteTable(
  "bots",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramBotId: integer().notNull(),
    username: text().notNull(),
    name: text().notNull(),
    description: text(),
    avatarUrl: text(),
    encryptedToken: text().notNull(),
    lastUpdateId: integer().notNull().default(0),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [uniqueIndex("bots_telegram_id_idx").on(t.telegramBotId)],
);

export type BotRow = typeof bots.$inferSelect;
export type NewBotRow = typeof bots.$inferInsert;
