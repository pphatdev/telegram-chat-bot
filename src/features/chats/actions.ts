"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import { bots, chats, messages, users, type ChatRow, type MessageRow } from "@/db/schema";
import { readSession } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import { TelegramApiError, TelegramClient } from "@/lib/telegram";
import {
    applyBotReaction,
    botReaction,
    normalizeReactionEmoji,
    parseReactionsJson,
    serializeReactions,
    type PersistedReaction,
} from "./reactions";
import { getChatsForBot, getMessagesForChat } from "./queries";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: "unauthenticated" | "not_found" | "internal" };

/**
 * All chat mutations run through here. Every action:
 *   1. Reads the session cookie for {userId, botId}.
 *   2. Verifies the target chat belongs to that bot (join guard).
 *   3. Performs the mutation.
 *
 * Direct DB access from client components is forbidden — this file is the
 * only authorized surface.
 */

async function withOwnedChat<T>(
  chatId: number,
  fn: (opts: { chatId: number; botId: number; now: number }) => Promise<T>,
): Promise<ActionResult<T>> {
  const session = await readSession();
  if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

  const db = await getDbAsync();
  const chat = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.botId, session.botId)))
    .get();
  if (!chat) return { ok: false, error: "Chat not found", code: "not_found" };

  try {
    const data = await fn({ chatId: chat.id, botId: session.botId, now: Math.floor(Date.now() / 1000) });
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error",
      code: "internal",
    };
  }
}

export async function togglePinChat(chatId: number, next: boolean): Promise<ActionResult> {
  return withOwnedChat(chatId, async ({ chatId, now }) => {
    const db = await getDbAsync();
    await db
      .update(chats)
      .set({ pinned: next, updatedAt: now })
      .where(eq(chats.id, chatId))
      .run();
  });
}

export async function markChatAsUnread(chatId: number): Promise<ActionResult> {
  return withOwnedChat(chatId, async ({ chatId, now }) => {
    const db = await getDbAsync();
    await db
      .update(chats)
      .set({ unreadCount: 1, updatedAt: now })
      .where(eq(chats.id, chatId))
      .run();
  });
}

export async function markChatAsRead(chatId: number): Promise<ActionResult> {
  return withOwnedChat(chatId, async ({ chatId, now }) => {
    const db = await getDbAsync();
    await db
      .update(chats)
      .set({ unreadCount: 0, updatedAt: now })
      .where(eq(chats.id, chatId))
      .run();
  });
}

export async function toggleMuteChat(chatId: number, next: boolean): Promise<ActionResult> {
  return withOwnedChat(chatId, async ({ chatId, now }) => {
    const db = await getDbAsync();
    await db
      .update(chats)
      .set({ muted: next, updatedAt: now })
      .where(eq(chats.id, chatId))
      .run();
  });
}

export async function archiveChat(chatId: number, next = true): Promise<ActionResult> {
  return withOwnedChat(chatId, async ({ chatId, now }) => {
    const db = await getDbAsync();
    await db
      .update(chats)
      .set({ archived: next, updatedAt: now })
      .where(eq(chats.id, chatId))
      .run();
  });
}

export async function deleteChat(chatId: number): Promise<ActionResult> {
  return withOwnedChat(chatId, async ({ chatId }) => {
    const db = await getDbAsync();
    // Cascade delete via foreign key ON DELETE CASCADE on messages.
    await db.delete(chats).where(eq(chats.id, chatId)).run();
  });
}

/**
 * Session-guarded chat-list read used by ChatShell's polling loop. The
 * initial render is server-fetched in page.tsx; this feeds subsequent
 * refreshes without a full page reload.
 */
export async function refreshChats(): Promise<ActionResult<ChatRow[]>> {
  const session = await readSession();
  if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };
  try {
    const data = await getChatsForBot(session.botId);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error",
      code: "internal",
    };
  }
}

/**
 * Load thread messages for a chat, ownership-verified. Used by ChatShell
 * on active-chat change and for infinite-scroll pagination.
 */
export async function loadMessages(
  chatId: number,
  opts: { limit?: number; cursorSentAt?: number } = {},
): Promise<ActionResult<MessageRow[]>> {
  return withOwnedChat(chatId, async ({ chatId }) => {
    return getMessagesForChat(chatId, opts);
  });
}

export type ReactResult = ActionResult<{ reactions: PersistedReaction[]; ownEmoji: string | null }>;

/**
 * Set (or clear) the bot's reaction on a message. Ownership-verified through
 * `messages → chats → bots → users` joins scoped to the session's bot.
 *
 * `nextEmoji = null` removes the bot's reaction. Passing the emoji that's
 * already the bot's current reaction is a no-op on Telegram's side — but we
 * still re-write the DB row to keep the client + server in sync in case the
 * caller's optimistic state drifted.
 *
 * The Telegram call is fire-once and idempotent: setMessageReaction replaces
 * the bot's slot atomically, so we don't need a separate "clear then set"
 * two-step. Local persistence uses `applyBotReaction` so any existing user
 * counts on the same emoji survive the swap.
 */
export async function reactToMessage(
    dbMessageId: number,
    nextEmoji: string | null,
): Promise<ReactResult> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const db = await getDbAsync();
    const row = await db
        .select({
            messageId: messages.id,
            telegramMessageId: messages.telegramMessageId,
            reactionsJson: messages.reactionsJson,
            telegramChatId: chats.telegramChatId,
            botId: bots.id,
            botUsername: bots.username,
            encryptedToken: bots.encryptedToken,
            debugEnabled: users.debugEnabled,
        })
        .from(messages)
        .innerJoin(chats, eq(chats.id, messages.chatId))
        .innerJoin(bots, eq(bots.id, chats.botId))
        .innerJoin(users, eq(users.id, bots.userId))
        .where(and(eq(messages.id, dbMessageId), eq(chats.botId, session.botId)))
        .get();
    if (!row) return { ok: false, error: "Message not found", code: "not_found" };
    if (!row.telegramMessageId) {
        return {
            ok: false,
            error: "This message has no Telegram id (send failed?) — nothing to react to.",
            code: "internal",
        };
    }

    // Normalize + validate the emoji before hitting Telegram. The Bot API
    // enforces a fixed allowlist and is strict about VS16 (`❤️` → `❤`) /
    // 😂-vs-🤣; anything off-list round-trips as `Bad Request:
    // REACTION_INVALID`. Failing fast here gives a clean toast instead of
    // a cryptic wire error and saves a network round-trip.
    let normalized: string | null = null;
    if (nextEmoji !== null) {
        normalized = normalizeReactionEmoji(nextEmoji);
        if (normalized === null) {
            return {
                ok: false,
                error: `Reaction "${nextEmoji}" is not in Telegram's bot-reactions allowlist.`,
                code: "internal",
            };
        }
    }

    const before = parseReactionsJson(row.reactionsJson);
    const currentBotEmoji = botReaction(before);
    if (currentBotEmoji === normalized) {
        // Already matches — skip the wire call, still return the current state.
        return { ok: true, data: { reactions: before, ownEmoji: currentBotEmoji } };
    }

    try {
        const { env } = await getCloudflareContext({ async: true });
        const token = await decrypt(row.encryptedToken, env.ENCRYPTION_SECRET);
        const client = new TelegramClient({
            token,
            debug: row.debugEnabled,
            debugLabel: `bot:${row.botId}${row.botUsername ? `:@${row.botUsername}` : ""}`,
        });
        await client.setMessageReaction({
            chat_id: row.telegramChatId,
            message_id: row.telegramMessageId,
            reaction: normalized ? [{ type: "emoji", emoji: normalized }] : [],
        });
    } catch (err) {
        if (err instanceof TelegramApiError) {
            return { ok: false, error: err.description, code: "internal" };
        }
        return {
            ok: false,
            error: err instanceof Error ? err.message : "unknown",
            code: "internal",
        };
    }

    const after = applyBotReaction(before, normalized);
    await db
        .update(messages)
        .set({ reactionsJson: serializeReactions(after) })
        .where(eq(messages.id, dbMessageId))
        .run();

    return { ok: true, data: { reactions: after, ownEmoji: normalized } };
}
