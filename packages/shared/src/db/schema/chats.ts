import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bots } from "./bots";

/**
 * Telegram chats/contacts observed by a bot: private conversations, groups,
 * supergroups, and channels. One row per (bot, telegramChatId) pair.
 *
 * Presentation fields (`avatarColor`, `avatarText`, `pinned`, `archived`,
 * `muted`) mirror the sidebar affordances in `chat-sidebar.tsx`.
 */
export const chats = sqliteTable(
  "chats",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    botId: integer()
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    telegramChatId: integer().notNull(),
    type: text({ enum: ["private", "group", "supergroup", "channel"] }).notNull(),
    title: text().notNull(),
    username: text(),
    avatarUrl: text(),
    avatarColor: text(),
    avatarText: text(),
    pinned: integer({ mode: "boolean" }).notNull().default(false),
    archived: integer({ mode: "boolean" }).notNull().default(false),
    muted: integer({ mode: "boolean" }).notNull().default(false),
    unreadCount: integer().notNull().default(0),
    lastMessageText: text(),
    lastMessageAt: integer(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("chats_bot_telegram_idx").on(t.botId, t.telegramChatId),
    index("chats_last_message_idx").on(t.botId, t.lastMessageAt),
  ],
);

export type ChatRow = typeof chats.$inferSelect;
export type NewChatRow = typeof chats.$inferInsert;
