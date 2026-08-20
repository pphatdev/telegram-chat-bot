import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bots } from "./bots";

/**
 * Broadcast dispatches — scheduled or immediate fan-outs of a single payload
 * to many chats. Feeds the "Scheduled" queue and broadcast history views
 * outlined in features.ui.md §3.
 *
 * `payloadJson` — Zod-validated composer output (text, media R2 keys, inline
 *   buttons). Never trust this on read; re-validate before dispatch.
 * `targetsJson` — array of resolved telegramChatIds after allowlist filtering.
 * `idempotencyKey` — client-provided so retried Cron ticks don't duplicate.
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
    dispatchedCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    lastError: text(),
    createdAt: integer().notNull(),
    startedAt: integer(),
    completedAt: integer(),
  },
  (t) => [
    index("broadcasts_bot_run_idx").on(t.botId, t.status, t.runAt),
  ],
);

export type BroadcastRow = typeof broadcasts.$inferSelect;
export type NewBroadcastRow = typeof broadcasts.$inferInsert;
