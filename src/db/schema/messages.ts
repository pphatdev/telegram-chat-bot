import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bots } from "./bots";
import { chats } from "./chats";

/**
 * Message history for a chat. Both inbound (direction='in') and outbound
 * (direction='out') live in the same table so the UI can render a merged
 * timeline. Outbound rows carry a delivery `status` mirroring the badges
 * defined in features.ui.md §2.4.
 *
 * Media payloads are addressed by R2 object keys stored in `mediaR2Key`; the
 * bytes themselves live in the R2 bucket bound as `env.R2`.
 */
export const messages = sqliteTable(
  "messages",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    botId: integer()
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    chatId: integer()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    telegramMessageId: integer(),
    direction: text({ enum: ["in", "out"] }).notNull(),
    kind: text({
      enum: ["text", "photo", "video", "audio", "sticker", "document", "location", "contact"],
    }).notNull().default("text"),
    authorName: text(),
    authorTelegramId: integer(),
    text: text(),
    replyToMessageId: integer(),
    mediaR2Key: text("media_r2_key"),
    mediaMimeType: text(),
    reactionsJson: text(),
    status: text({
      enum: ["sending", "sent", "delivered", "read", "failed"],
    }),
    failureReason: text(),
    sentAt: integer().notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("messages_bot_telegram_idx").on(t.botId, t.telegramMessageId),
    index("messages_chat_sent_idx").on(t.chatId, t.sentAt),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
