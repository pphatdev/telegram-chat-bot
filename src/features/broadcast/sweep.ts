import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/client";
import { broadcasts, type BroadcastRow } from "@/db/schema";
import { dispatchOutboundMessage } from "./dispatcher";
import { outboundMessageSchema } from "./schemas";

/**
 * Broadcast-sweep primitives shared by:
 *   - The Cron endpoint (`/api/cron/scheduled-broadcasts`) — background
 *     drainage of `status='scheduled' AND run_at<=now`.
 *   - The interactive "Send Now" server action — same code path, single
 *     row, no cron auth.
 *
 * Every drain step is:
 *   1. Optimistic CAS claim (`status='scheduled' → 'dispatching'`) so
 *      concurrent sweeps skip already-claimed rows.
 *   2. Re-parse payload + targets with Zod (never trust stored JSON).
 *   3. Iterate targets calling `dispatchOutboundMessage` — same guardrails
 *      (allowlist, rate-limit, encrypted token) as the composer.
 *   4. Finalize with tallied counts and terminal status.
 */

export const targetsSchema = z.array(
    z.object({ chatId: z.number().int().positive() }),
);

export interface BroadcastRunResult {
    id: number;
    status: BroadcastRow["status"];
    dispatched: number;
    failed: number;
    error?: string;
}

/**
 * Sweep one broadcast row. Idempotent — safe to call even if another sweep
 * has already claimed the row (returns `already_claimed`).
 */
export async function runBroadcast(
    db: AppDatabase,
    bc: BroadcastRow,
): Promise<BroadcastRunResult> {
    const started = Math.floor(Date.now() / 1000);
    const claim = await db
        .update(broadcasts)
        .set({ status: "dispatching", startedAt: started })
        .where(and(eq(broadcasts.id, bc.id), eq(broadcasts.status, "scheduled")))
        .run();

    if (claim.meta.changes === 0) {
        return {
            id: bc.id,
            status: bc.status,
            dispatched: bc.dispatchedCount,
            failed: bc.failedCount,
            error: "already_claimed",
        };
    }

    let payload;
    try {
        payload = outboundMessageSchema.parse(JSON.parse(bc.payloadJson));
    } catch (err) {
        return finalize(db, bc.id, "failed", 0, 0, err instanceof Error ? err.message : "invalid_payload");
    }

    let targets;
    try {
        targets = targetsSchema.parse(JSON.parse(bc.targetsJson));
    } catch (err) {
        return finalize(db, bc.id, "failed", 0, 0, err instanceof Error ? err.message : "invalid_targets");
    }

    let dispatched = 0;
    let failed = 0;
    let lastError: string | undefined;

    for (const target of targets) {
        const result = await dispatchOutboundMessage(db, {
            botId: bc.botId,
            chatId: target.chatId,
            payload,
        });
        if (result.ok) {
            dispatched++;
        } else {
            failed++;
            lastError = describeFailure(result);
        }
    }

    return finalize(
        db,
        bc.id,
        dispatched === 0 && failed > 0 ? "failed" : "completed",
        dispatched,
        failed,
        lastError,
    );
}

async function finalize(
    db: AppDatabase,
    id: number,
    status: BroadcastRow["status"],
    dispatched: number,
    failed: number,
    lastError?: string,
): Promise<BroadcastRunResult> {
    const completedAt = Math.floor(Date.now() / 1000);
    await db
        .update(broadcasts)
        .set({
            status,
            dispatchedCount: dispatched,
            failedCount: failed,
            lastError: lastError ?? null,
            completedAt,
        })
        .where(eq(broadcasts.id, id))
        .run();
    return { id, status, dispatched, failed, error: lastError };
}

function describeFailure(
    fail: Exclude<Awaited<ReturnType<typeof dispatchOutboundMessage>>, { ok: true }>,
): string {
    switch (fail.reason) {
        case "not_found":
            return "target_not_found";
        case "access_denied":
            return `denied:${fail.detail}`;
        case "rate_limited":
            return `rate_limited:${fail.bucket}`;
        case "telegram_error":
            return `telegram:${fail.errorCode}:${fail.description}`;
        case "internal":
            return `internal:${fail.message}`;
    }
}
