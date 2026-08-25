import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bots } from "./bots";

/**
 * Broadcast dispatches — scheduled or immediate fan-outs of a single payload
 * to many chats. Feeds the "Scheduled" queue and broadcast history views
 * outlined in features.ui.md §3.
 *
 * `payloadJson`     — Zod-validated composer output (text, media R2 keys,
 *                     inline buttons). Never trust this on read; re-validate
 *                     before dispatch.
 * `targetsJson`     — immutable snapshot of the originally-requested target
 *                     chat IDs, kept for audit/replay. Per-target delivery
 *                     state lives in `broadcast_targets`.
 * `idempotencyKey`  — client-provided so retried Cron ticks don't duplicate.
 *                     Enforced by the unique index on (bot_id, idempotency_key).
 * `nextAttemptAt`   — earliest unix-seconds timestamp the sweep should touch
 *                     this row again. Starts at runAt; each partial pass sets
 *                     it to the min(next_attempt_at) of remaining targets.
 *
 * `dispatchedCount` / `failedCount` are denormalized aggregates refreshed at
 * the end of every sweep pass so history views don't have to COUNT() on read.
 */
export const broadcasts = sqliteTable(
  "broadcasts",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    botId: integer()
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    idempotencyKey: text().notNull(),
    payloadJson: text().notNull(),
    targetsJson: text().notNull(),
    status: text({
      enum: ["scheduled", "dispatching", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("scheduled"),
    runAt: integer().notNull(),
    nextAttemptAt: integer().notNull(),
    dispatchedCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    lastError: text(),
    createdAt: integer().notNull(),
    startedAt: integer(),
    completedAt: integer(),
  },
  (t) => [
    uniqueIndex("broadcasts_bot_idempotency_idx").on(t.botId, t.idempotencyKey),
    index("broadcasts_sweep_idx").on(t.status, t.nextAttemptAt),
    index("broadcasts_bot_created_idx").on(t.botId, t.createdAt),
  ],
);

export type BroadcastRow = typeof broadcasts.$inferSelect;
export type NewBroadcastRow = typeof broadcasts.$inferInsert;
