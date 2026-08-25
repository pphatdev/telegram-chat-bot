import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bots } from "./bots";
import { chats } from "./chats";

/**
 * Audit trail of Telegram `callback_query` updates (inline-button taps). We
 * `answerCallbackQuery` right away in the webhook handler; this table records
 * the fact so we can:
 *   - correlate outbound broadcasts against callback engagement,
 *   - drive future analytics without re-reading raw webhook payloads.
 *
 * Kept as an append-only log — no updates, no deletes.
 */
export const callbackEvents = sqliteTable(
  "callback_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    botId: integer()
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    chatId: integer().references(() => chats.id, { onDelete: "set null" }),
    telegramCallbackId: text().notNull(),
    fromTelegramId: integer().notNull(),
    data: text(),
    createdAt: integer().notNull(),
  },
  (t) => [
    index("callback_events_bot_created_idx").on(t.botId, t.createdAt),
  ],
);

export type CallbackEventRow = typeof callbackEvents.$inferSelect;
export type NewCallbackEventRow = typeof callbackEvents.$inferInsert;
