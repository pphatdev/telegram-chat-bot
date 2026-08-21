import { and, desc, eq, lt } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import { chats, messages, type ChatRow, type MessageRow } from "@/db/schema";

/**
 * Read the sidebar-facing chat list for a given bot.
 *
 * Pinned rows always float to the top; within each pin group we sort by the
 * most recent activity (`lastMessageAt`). Archived rows are excluded — they
 * belong on a future "Archived" tab, not the primary list.
 *
 * Called from server components / server actions only — resolves a Cloudflare
 * request context via getDbAsync.
 */
export async function getChatsForBot(botId: number): Promise<ChatRow[]> {
  const db = await getDbAsync();
  return db
    .select()
    .from(chats)
    .where(and(eq(chats.botId, botId), eq(chats.archived, false)))
    .orderBy(desc(chats.pinned), desc(chats.lastMessageAt))
    .all();
}

/**
 * Ownership-guarded single-chat fetch used by the per-chat RSC page
 * (`/chat/[chatId]`). Returns `undefined` when the chat doesn't exist OR
 * doesn't belong to the caller's bot — the page treats both as `notFound()`
 * so we never leak the existence of a chat owned by another bot.
 */
export async function getChatById(
  botId: number,
  chatId: number,
): Promise<ChatRow | undefined> {
  const db = await getDbAsync();
  const row = await db
    .select()
    .from(chats)
    .where(and(eq(chats.botId, botId), eq(chats.id, chatId)))
    .get();
  return row;
}

/**
 * Fetch a page of messages for a chat, newest-first, with a cursor for
 * infinite scroll (`cursor` = the oldest sentAt from the previous page).
 *
 * The caller is expected to have already asserted that the chat belongs to
 * the session's bot — this query does NOT re-check ownership, so never wire
 * it directly to a public endpoint.
 */
export async function getMessagesForChat(
  chatId: number,
  opts: { limit?: number; cursorSentAt?: number } = {},
): Promise<MessageRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const db = await getDbAsync();
  const where = opts.cursorSentAt
    ? and(eq(messages.chatId, chatId), lt(messages.sentAt, opts.cursorSentAt))
    : eq(messages.chatId, chatId);

  const rows = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(desc(messages.sentAt))
    .limit(limit)
    .all();

  // Return chronological (oldest first) so the UI can append without
  // reversing on every render.
  return rows.reverse();
}
