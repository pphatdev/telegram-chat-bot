import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Operator accounts that log into the panel.
 * A user owns one or more bots.
 *
 * `passwordHash` is bcrypt/argon2-formatted — never a plaintext or reversibly
 * encrypted value. Sensitive bot API tokens live on the `bots` table under
 * `encryptedToken` (AES-GCM-256).
 */
export const users = sqliteTable(
  "users",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    email: text().notNull(),
    username: text().notNull(),
    passwordHash: text().notNull(),
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
