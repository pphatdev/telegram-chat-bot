import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Operator accounts that log into the panel.
 * A user owns one or more bots.
 *
 * `passwordHash` is PBKDF2-formatted (`pbkdf2$<iterations>$<salt>$<hash>`) —
 * never plaintext or reversibly encrypted. Sensitive bot API tokens live on
 * the `bots` table under `encryptedToken` (AES-GCM-256).
 *
 * `passcodeHash` (optional) is a second-factor 4-digit passcode used by the
 * Ctrl/Cmd+L in-app lock overlay. Same PBKDF2 format as `passwordHash`; a
 * NULL value means the user has not enabled the feature.
 *
 * `isAdmin` gates destructive maintenance actions such as the AES key
 * rotation runbook (`src/lib/crypto/rotate.ts`).
 */
export const users = sqliteTable(
  "users",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    email: text().notNull(),
    username: text().notNull(),
    passwordHash: text().notNull(),
    passcodeHash: text(),
    passcodeEnabled: integer({ mode: "boolean" }).notNull().default(false),
    autoLockMinutes: integer().notNull().default(5),
    isAdmin: integer({ mode: "boolean" }).notNull().default(false),
    /**
     * When true, every Telegram API call and every inbound webhook payload
     * for this user's bots is logged to the Worker's stdout. Opt-in per
     * operator via Settings → Debug logging. Payloads may contain PII (chat
     * IDs, message text) so the flag is explicitly gated.
     */
    debugEnabled: integer({ mode: "boolean" }).notNull().default(false),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_username_idx").on(t.username),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
