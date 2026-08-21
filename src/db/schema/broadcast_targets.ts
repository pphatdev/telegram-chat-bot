import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { broadcasts } from "./broadcasts";
import { chats } from "./chats";

/**
 * Per-target delivery ledger for a broadcast fan-out. One row per (broadcast,
 * chat) pair — created up-front by `createBroadcast` and mutated by the sweep
 * as targets progress through the retry state machine.
 *
 * status transitions:
 *   pending → sent      — dispatcher succeeded, sent_at populated.
 *   pending → failed    — permanent failure (access_denied, telegram 4xx not
 *                         in the retry set, or retry budget exhausted).
 *   pending → pending   — transient failure (429 / 5xx / rate_limited).
 *                         retry_count is bumped and next_attempt_at is set
 *                         to `now + backoff`. The sweep picks it up on the
 *                         next tick after next_attempt_at elapses.
 *
 * `messageId` is set on success — foreign-key-free reference to
 * `messages.id` (kept loose because failed rows never insert a message).
 */
export const broadcastTargets = sqliteTable(
  "broadcast_targets",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    broadcastId: integer()
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    chatId: integer()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    status: text({ enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    retryCount: integer().notNull().default(0),
    /**
     * Unix seconds. NULL for terminal rows. On pending rows, the sweep MUST
     * NOT attempt the target before this time.
     */
    nextAttemptAt: integer(),
    /** Last attempt time, unix seconds. */
    attemptedAt: integer(),
    /** Populated only on `sent` rows. */
    sentAt: integer(),
    /** Populated only on `failed` rows or transient errors that will retry. */
    failureReason: text(),
    messageId: integer(),
    createdAt: integer().notNull(),
  },
  (t) => [
    index("broadcast_targets_broadcast_status_idx").on(t.broadcastId, t.status),
    index("broadcast_targets_next_attempt_idx").on(t.nextAttemptAt),
  ],
);

export type BroadcastTargetRow = typeof broadcastTargets.$inferSelect;
export type NewBroadcastTargetRow = typeof broadcastTargets.$inferInsert;
