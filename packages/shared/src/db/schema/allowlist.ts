import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bots } from "./bots";

/**
 * Per-bot allowlist / blocklist / keyword / sticker rules enforced by
 * `src/lib/access-control/guards.ts` before any broadcast dispatch.
 *
 * Semantics:
 *  - `whitelist`  → if any rows exist for a bot, dispatch is restricted to
 *                   these targets only.
 *  - `blacklist`  → matching targets are always rejected, even if also
 *                   present in the whitelist.
 *  - `keyword`    → outgoing text containing this substring is rejected.
 *  - `sticker`    → outgoing sticker file_ids matching this rule are rejected.
 */
export const allowlistEntries = sqliteTable(
  "allowlist_entries",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    botId: integer()
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    listType: text({
      enum: ["whitelist", "blacklist", "keyword", "sticker"],
    }).notNull(),
    value: text().notNull(),
    note: text(),
    createdAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("allowlist_bot_type_value_idx").on(t.botId, t.listType, t.value),
    index("allowlist_bot_type_idx").on(t.botId, t.listType),
  ],
);

export type AllowlistEntryRow = typeof allowlistEntries.$inferSelect;
export type NewAllowlistEntryRow = typeof allowlistEntries.$inferInsert;
