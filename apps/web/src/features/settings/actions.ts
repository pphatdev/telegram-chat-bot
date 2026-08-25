"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDbAsync } from "@/db/context";
import { allowlistEntries, users, type AllowlistEntryRow } from "@telegram-bot/shared/db/schema";
import { readSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@telegram-bot/shared/crypto";
import { createD1AnonRateLimitStore } from "@telegram-bot/shared/rate-limit/anon-d1-store";
import { consume } from "@telegram-bot/shared/rate-limit/token-bucket";
import {
  getAllowlistEntries,
  getChatMessageCounts,
  getDebugEnabled,
  type ChatMessageCounts,
  type AllowlistListType,
} from "./queries";

export type SettingsResult<T = void> =
  | { ok: true; data: T }
  | {
        ok: false;
        error: string;
        code?:
            | "unauthenticated"
            | "duplicate"
            | "not_found"
            | "invalid"
            | "internal"
            | "rate_limited"
            | "not_enabled";
        retryAfterMs?: number;
    };

const listTypeSchema = z.enum(["whitelist", "blacklist", "keyword", "sticker"]);
const valueSchema = z.string().trim().min(1).max(200);

/** Passcode is a numeric string, 4-8 digits — matches the on-screen numpad. */
const passcodeSchema = z
    .string()
    .regex(/^\d{4,8}$/, "Passcode must be 4-8 digits");

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

/* --- Passcode lifecycle ------------------------------------------------ */

/**
 * Rate-limit config for `verifyPasscode`. 5 attempts per 5 minutes — enough
 * for a fat-finger typo, tight enough that a 4-digit brute force takes
 * ~14 days per user.
 */
const PASSCODE_ATTEMPT_LIMIT = { capacity: 5, refillPerSecond: 5 / 300 } as const;

/**
 * Enable the passcode lock and store its PBKDF2 hash.
 *
 * Requires the caller's account password to authorize the change — reuses
 * the same password-verification path as login. Preventing casual passcode
 * hijack by a coworker who walks up to an unlocked screen matters here.
 */
export async function setPasscode(
    accountPassword: string,
    passcode: string,
): Promise<SettingsResult<{ enabled: true }>> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const passcodeParsed = passcodeSchema.safeParse(passcode);
    if (!passcodeParsed.success) {
        return { ok: false, error: passcodeParsed.error.issues[0]?.message ?? "Invalid passcode", code: "invalid" };
    }

    const db = await getDbAsync();
    const user = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, session.userId))
        .get();
    if (!user) return { ok: false, error: "User not found", code: "not_found" };

    const passwordOk = await verifyPassword(accountPassword, user.passwordHash);
    if (!passwordOk) {
        return { ok: false, error: "Invalid account password", code: "invalid" };
    }

    const hash = await hashPassword(passcodeParsed.data);
    const now = Math.floor(Date.now() / 1000);
    await db
        .update(users)
        .set({ passcodeHash: hash, passcodeEnabled: true, updatedAt: now })
        .where(eq(users.id, session.userId))
        .run();
    return { ok: true, data: { enabled: true } };
}

/**
 * Disable the passcode lock. Requires the account password so a lifted
 * unlocked session can't quietly turn the second factor off.
 */
export async function disablePasscode(
    accountPassword: string,
): Promise<SettingsResult<{ enabled: false }>> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const db = await getDbAsync();
    const user = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, session.userId))
        .get();
    if (!user) return { ok: false, error: "User not found", code: "not_found" };

    const passwordOk = await verifyPassword(accountPassword, user.passwordHash);
    if (!passwordOk) {
        return { ok: false, error: "Invalid account password", code: "invalid" };
    }

    const now = Math.floor(Date.now() / 1000);
    await db
        .update(users)
        .set({ passcodeHash: null, passcodeEnabled: false, updatedAt: now })
        .where(eq(users.id, session.userId))
        .run();
    return { ok: true, data: { enabled: false } };
}

/**
 * Update the auto-lock idle timeout in minutes. 0 disables idle auto-lock
 * (the passcode overlay can still be triggered manually via Ctrl/Cmd+L).
 */
export async function setAutoLockMinutes(minutes: number): Promise<SettingsResult<{ autoLockMinutes: number }>> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const parsed = z.number().int().min(0).max(60 * 24).safeParse(minutes);
    if (!parsed.success) {
        return { ok: false, error: "Auto-lock must be 0-1440 minutes", code: "invalid" };
    }

    const db = await getDbAsync();
    const now = Math.floor(Date.now() / 1000);
    await db
        .update(users)
        .set({ autoLockMinutes: parsed.data, updatedAt: now })
        .where(eq(users.id, session.userId))
        .run();
    return { ok: true, data: { autoLockMinutes: parsed.data } };
}

/**
 * Verify a passcode attempt. Rate-limited per user (5 attempts / 5 min)
 * against `anon_rate_limits` — brute-forcing 4 digits without a limit is
 * a matter of seconds otherwise.
 *
 * A successful verify does NOT reset the rate-limit bucket by design: if
 * the operator legitimately mistypes 5 times, they can wait a minute for
 * one token to refill and try again. Attempts are cheap; convenience of
 * "unlimited retries after one success" is not worth the brute-force
 * regression it would introduce.
 */
/* --- Debug logging toggle --------------------------------------------- */

/**
 * Enable or disable debug logging for the signed-in operator. When enabled,
 * every outbound Telegram Bot API call (getMe, sendMessage, getUpdates, ...)
 * and every inbound webhook payload for the user's bots is written to the
 * Worker's stdout, prefixed with `[tg:debug] bot:<id>:@<username>`. Payloads
 * may contain PII (chat IDs, message text) so this is strictly opt-in.
 *
 * Session-scoped: the toggle affects only the caller's bots, never anyone
 * else's — the flag lives on `users.debug_enabled` and every dispatcher /
 * webhook / long-poll site JOINs to the owning user before deciding whether
 * to log.
 */
export async function setDebugEnabled(enabled: boolean): Promise<SettingsResult<{ enabled: boolean }>> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const parsed = z.boolean().safeParse(enabled);
    if (!parsed.success) return { ok: false, error: "Invalid value", code: "invalid" };

    const db = await getDbAsync();
    const now = Math.floor(Date.now() / 1000);
    await db
        .update(users)
        .set({ debugEnabled: parsed.data, updatedAt: now })
        .where(eq(users.id, session.userId))
        .run();
    return { ok: true, data: { enabled: parsed.data } };
}

export async function loadDebugEnabled(): Promise<SettingsResult<{ enabled: boolean }>> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };
    const enabled = await getDebugEnabled(session.userId);
    return { ok: true, data: { enabled } };
}

/* --- Passcode lifecycle continued ------------------------------------- */

export async function verifyPasscode(
    passcode: string,
): Promise<SettingsResult<{ verified: true }>> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const db = await getDbAsync();

    const rl = await consume(
        createD1AnonRateLimitStore(db),
        `passcode:${session.userId}`,
        PASSCODE_ATTEMPT_LIMIT,
    );
    if (!rl.allowed) {
        return {
            ok: false,
            error: "Too many attempts, try again shortly",
            code: "rate_limited",
            retryAfterMs: rl.retryAfterMs,
        };
    }

    const user = await db
        .select({
            passcodeHash: users.passcodeHash,
            passcodeEnabled: users.passcodeEnabled,
        })
        .from(users)
        .where(eq(users.id, session.userId))
        .get();
    if (!user) return { ok: false, error: "User not found", code: "not_found" };
    if (!user.passcodeEnabled || !user.passcodeHash) {
        return { ok: false, error: "Passcode is not enabled", code: "not_enabled" };
    }

    const ok = await verifyPassword(passcode, user.passcodeHash);
    if (!ok) {
        return { ok: false, error: "Incorrect passcode", code: "invalid" };
    }
    return { ok: true, data: { verified: true } };
}
