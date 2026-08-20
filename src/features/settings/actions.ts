"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDbAsync } from "@/db/client";
import { allowlistEntries, type AllowlistEntryRow } from "@/db/schema";
import { readSession } from "@/lib/auth/session";
import { getAllowlistEntries, getChatMessageCounts, type ChatMessageCounts, type AllowlistListType } from "./queries";

export type SettingsResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: "unauthenticated" | "duplicate" | "not_found" | "invalid" | "internal" };

const listTypeSchema = z.enum(["whitelist", "blacklist", "keyword", "sticker"]);
const valueSchema = z.string().trim().min(1).max(200);

/**
 * Session-guarded allowlist CRUD. Every action:
 *   1. Reads {userId, botId} from the session cookie.
 *   2. Constrains the row to that bot — one operator cannot inspect or
 *      mutate another bot's rules.
 *
 * `listType` and `value` are strict Zod-validated to short-circuit obvious
 * abuse (empty strings, huge blobs, unknown categories).
 */

async function withSessionBot<T>(
  fn: (botId: number) => Promise<T>,
): Promise<SettingsResult<T>> {
  const session = await readSession();
  if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };
  try {
    const data = await fn(session.botId);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error",
      code: "internal",
    };
  }
}

export async function loadAllowlist(
  listType?: AllowlistListType,
): Promise<SettingsResult<AllowlistEntryRow[]>> {
  return withSessionBot((botId) => getAllowlistEntries(botId, listType));
}

export async function addAllowlistEntry(
  listTypeRaw: string,
  valueRaw: string,
  note?: string,
): Promise<SettingsResult<AllowlistEntryRow>> {
  const parsedType = listTypeSchema.safeParse(listTypeRaw);
  const parsedValue = valueSchema.safeParse(valueRaw);
  if (!parsedType.success) return { ok: false, error: "Invalid list type", code: "invalid" };
  if (!parsedValue.success) return { ok: false, error: "Value is required", code: "invalid" };

  return withSessionBot(async (botId) => {
    const db = await getDbAsync();
    const now = Math.floor(Date.now() / 1000);
    const inserted = await db
      .insert(allowlistEntries)
      .values({
        botId,
        listType: parsedType.data,
        value: parsedValue.data,
        note: note?.trim() || null,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning()
      .get();

    if (!inserted) {
      // UNIQUE (botId, listType, value) collision — surface a friendly error.
      throw new Error("Entry already exists");
    }
    return inserted;
  });
}

export async function removeAllowlistEntry(id: number): Promise<SettingsResult> {
  return withSessionBot(async (botId) => {
    const db = await getDbAsync();
    const res = await db
      .delete(allowlistEntries)
      .where(and(eq(allowlistEntries.id, id), eq(allowlistEntries.botId, botId)))
      .run();
    if (res.meta.changes === 0) throw new Error("Entry not found");
  });
}

/**
 * Media counts for the profile drawer. Not session-guarded because the
 * caller (chat-profile) is invoked from ChatShell, which itself is behind
 * middleware.ts + reads only the session bot's chats.
 */
export async function loadChatMessageCounts(
  chatId: number,
): Promise<SettingsResult<ChatMessageCounts>> {
  return withSessionBot(async () => getChatMessageCounts(chatId));
}
