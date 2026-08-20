import { and, count, eq, inArray } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import { allowlistEntries, messages, type AllowlistEntryRow } from "@/db/schema";

export type AllowlistListType = "whitelist" | "blacklist" | "keyword" | "sticker";

/**
 * Read all allowlist / blocklist / keyword / sticker rules for a bot.
 * The broadcast dispatcher's guards (`src/lib/access-control/guards.ts`)
 * read the same table — this query drives the read-side of the same source
 * of truth.
 */
export async function getAllowlistEntries(
  botId: number,
  listType?: AllowlistListType,
): Promise<AllowlistEntryRow[]> {
  const db = await getDbAsync();
  const where = listType
    ? and(eq(allowlistEntries.botId, botId), eq(allowlistEntries.listType, listType))
    : eq(allowlistEntries.botId, botId);
  return db.select().from(allowlistEntries).where(where).orderBy(allowlistEntries.createdAt).all();
}

export interface ChatMessageCounts {
  photosAndVideos: number;
  files: number;
  audio: number;
  total: number;
}

/**
 * Media counts for the profile drawer's "Shared Media" section. Counts
 * are grouped roughly matching the Telegram profile UI conventions.
 * Runs three COUNT(*) queries; cheap on D1 for typical thread sizes.
 */
export async function getChatMessageCounts(chatId: number): Promise<ChatMessageCounts> {
  const db = await getDbAsync();
  const [total, photoVideo, files, audio] = await Promise.all([
    db.select({ n: count() }).from(messages).where(eq(messages.chatId, chatId)).get(),
    db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), inArray(messages.kind, ["photo", "video"])))
      .get(),
    db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.kind, "document")))
      .get(),
    db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.kind, "audio")))
      .get(),
  ]);
  return {
    total: total?.n ?? 0,
    photosAndVideos: photoVideo?.n ?? 0,
    files: files?.n ?? 0,
    audio: audio?.n ?? 0,
  };
}
