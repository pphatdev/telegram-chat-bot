import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@telegram-bot/shared/db";
import { bots, chats, messages } from "@telegram-bot/shared/db/schema";
import type { TelegramMessage, TelegramUpdate } from "@telegram-bot/shared/telegram/types";

export type PersistResult =
  | { kind: "message"; chatId: number; messageId: number }
  | { kind: "skipped"; reason: string };

/**
 * Persist an inbound Telegram Update into D1.
 *
 * Only handles the update kinds we need for the initial milestone:
 *   - `message`      — a fresh inbound message
 *   - `channel_post` — same, but from a channel the bot admins
 *
 * `edited_message`, `callback_query`, etc. are acknowledged but not stored
 * yet — extend here as those features come online. Callers should always
 * pass in the Zod-validated update from `telegramUpdateSchema.parse()`.
 */
export async function persistTelegramUpdate(
  db: AppDatabase,
  botId: number,
  update: TelegramUpdate,
): Promise<PersistResult> {
  const tgMessage = update.message ?? update.channel_post;
  if (!tgMessage) {
    // Track the offset even for updates we skip so we don't re-process them.
    await bumpLastUpdateId(db, botId, update.update_id);
    return { kind: "skipped", reason: "unhandled_update_kind" };
  }

  const now = Math.floor(Date.now() / 1000);
  const chatRow = await upsertChat(db, botId, tgMessage, now);
  const inserted = await db
    .insert(messages)
    .values({
      botId,
      chatId: chatRow.id,
      telegramMessageId: tgMessage.message_id,
      direction: "in",
      kind: detectMessageKind(tgMessage),
      authorName: authorLabel(tgMessage),
      authorTelegramId: tgMessage.from?.id,
      text: tgMessage.text ?? tgMessage.caption ?? null,
      replyToMessageId: tgMessage.reply_to_message?.message_id,
      sentAt: tgMessage.date,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id })
    .get();

  // Refresh chat metadata for the sidebar preview + unread badge.
  await db
    .update(chats)
    .set({
      lastMessageText: tgMessage.text ?? tgMessage.caption ?? null,
      lastMessageAt: tgMessage.date,
      unreadCount: sql`${chats.unreadCount} + 1`,
      updatedAt: now,
    })
    .where(eq(chats.id, chatRow.id))
    .run();

  await bumpLastUpdateId(db, botId, update.update_id);

  return {
    kind: "message",
    chatId: chatRow.id,
    // `inserted` is undefined when the message already existed (retry/dupe).
    // Callers should treat that as a no-op, not an error.
    messageId: inserted?.id ?? 0,
  };
}

async function upsertChat(
  db: AppDatabase,
  botId: number,
  msg: TelegramMessage,
  now: number,
): Promise<{ id: number }> {
  const existing = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.botId, botId), eq(chats.telegramChatId, msg.chat.id)))
    .get();

  if (existing) return existing;

  const title = msg.chat.title
    ?? [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ")
    ?? msg.chat.username
    ?? String(msg.chat.id);

  const inserted = await db
    .insert(chats)
    .values({
      botId,
      telegramChatId: msg.chat.id,
      type: msg.chat.type,
      title,
      username: msg.chat.username,
      avatarText: initials(title),
      avatarColor: pickAvatarColor(msg.chat.id),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: chats.id })
    .get();
  if (!inserted) throw new Error("Failed to upsert chat");
  return inserted;
}

async function bumpLastUpdateId(db: AppDatabase, botId: number, updateId: number) {
  await db
    .update(bots)
    .set({
      lastUpdateId: sql`MAX(${bots.lastUpdateId}, ${updateId})`,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(bots.id, botId))
    .run();
}

function detectMessageKind(msg: TelegramMessage): "text" | "photo" | "video" | "audio" | "sticker" | "document" | "location" | "contact" {
  const m = msg as unknown as Record<string, unknown>;
  if (m.photo) return "photo";
  if (m.video) return "video";
  if (m.audio || m.voice) return "audio";
  if (m.sticker) return "sticker";
  if (m.document) return "document";
  if (m.location) return "location";
  if (m.contact) return "contact";
  return "text";
}

function authorLabel(msg: TelegramMessage): string {
  const from = msg.from;
  if (!from) return msg.chat.title ?? "Unknown";
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return name || from.username || `user:${from.id}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-slate-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-500",
];

function pickAvatarColor(seed: number): string {
  return AVATAR_COLORS[Math.abs(seed) % AVATAR_COLORS.length];
}
