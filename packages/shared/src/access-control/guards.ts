import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { allowlistEntries } from "../db/schema";

/**
 * Server-side allowlist / blocklist enforcement.
 *
 * These guards MUST run before every outbound Telegram dispatch — inside the
 * broadcast worker, inside any admin-triggered send action, and inside any
 * webhook auto-reply. Client-side chip lists are advisory only; the source
 * of truth lives in `allowlist_entries`.
 *
 * Semantics (see .agents/features.ui.md §4.5 and .agents/rules.md §6):
 *   - `blacklist` matches → always deny.
 *   - `whitelist` non-empty AND target not present → deny.
 *   - otherwise → allow.
 *
 * Callers should catch `AccessDeniedError`, log the reason, and record it on
 * the broadcast row rather than swallowing.
 */

export type AccessDenyReason =
  | "blacklisted-target"
  | "not-in-whitelist"
  | "blocked-keyword"
  | "blocked-sticker";

export class AccessDeniedError extends Error {
  constructor(
    public readonly reason: AccessDenyReason,
    public readonly detail?: string,
  ) {
    super(`access denied: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "AccessDeniedError";
  }
}

/**
 * Verify a candidate broadcast target is permitted.
 * `target` may be a numeric telegramChatId (`"123456"`) or a `@handle`.
 */
export async function assertBroadcastTargetAllowed(
  db: AppDatabase,
  botId: number,
  target: string,
): Promise<void> {
  const entries = await db
    .select({ listType: allowlistEntries.listType, value: allowlistEntries.value })
    .from(allowlistEntries)
    .where(
      and(
        eq(allowlistEntries.botId, botId),
        // list type filtered client-side below to keep the query index-friendly
      ),
    )
    .all();

  const norm = normalizeTarget(target);
  const blacklist = new Set<string>();
  const whitelist = new Set<string>();
  for (const row of entries) {
    if (row.listType === "blacklist") blacklist.add(normalizeTarget(row.value));
    else if (row.listType === "whitelist") whitelist.add(normalizeTarget(row.value));
  }

  if (blacklist.has(norm)) {
    throw new AccessDeniedError("blacklisted-target", target);
  }
  if (whitelist.size > 0 && !whitelist.has(norm)) {
    throw new AccessDeniedError("not-in-whitelist", target);
  }
}

/**
 * Reject outbound text containing a banned substring. Case-insensitive.
 */
export async function assertKeywordAllowed(
  db: AppDatabase,
  botId: number,
  text: string,
): Promise<void> {
  const rows = await db
    .select({ value: allowlistEntries.value })
    .from(allowlistEntries)
    .where(
      and(
        eq(allowlistEntries.botId, botId),
        eq(allowlistEntries.listType, "keyword"),
      ),
    )
    .all();

  const haystack = text.toLowerCase();
  for (const row of rows) {
    if (haystack.includes(row.value.toLowerCase())) {
      throw new AccessDeniedError("blocked-keyword", row.value);
    }
  }
}

/**
 * Reject an outbound sticker file_id or set name that has been banned.
 */
export async function assertStickerAllowed(
  db: AppDatabase,
  botId: number,
  fileIdOrSetName: string,
): Promise<void> {
  const hit = await db
    .select({ value: allowlistEntries.value })
    .from(allowlistEntries)
    .where(
      and(
        eq(allowlistEntries.botId, botId),
        eq(allowlistEntries.listType, "sticker"),
        eq(allowlistEntries.value, fileIdOrSetName),
      ),
    )
    .get();

  if (hit) {
    throw new AccessDeniedError("blocked-sticker", fileIdOrSetName);
  }
}

function normalizeTarget(v: string): string {
  const trimmed = v.trim();
  return trimmed.startsWith("@") ? trimmed.toLowerCase() : trimmed;
}
