"use server";

import { and, eq } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import { chats, type ChatRow, type MessageRow } from "@/db/schema";
import { readSession } from "@/lib/auth/session";
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
