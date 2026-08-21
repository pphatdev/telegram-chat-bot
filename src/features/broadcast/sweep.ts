import { and, eq, gt, isNull, lte, min, or, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import {
    broadcastTargets,
    broadcasts,
    type BroadcastRow,
    type BroadcastTargetRow,
} from "@/db/schema";
import { dispatchOutboundMessage, type DispatchResult } from "./dispatcher";
import { outboundMessageSchema } from "./schemas";

/**
 * Broadcast-sweep primitives shared by:
 *   - The Cloudflare Cron Trigger's scheduled() handler — background
 *     drainage of due rows.
 *   - The admin HTTP endpoint (`/api/cron/scheduled-broadcasts`) — manual
 *     kick for local dev / debugging.
 *   - The interactive "Send Now" server action — same code path, single
 *     row, no cron auth.
 *
 * Concurrency model:
 *   - Each broadcast row acts as a lease. A sweep pass CAS-claims the row
 *     by advancing `next_attempt_at` to `now + PROCESSING_LOCK_SECONDS`
 *     under a `WHERE next_attempt_at <= now AND status IN
 *     ('scheduled','dispatching')` guard. Concurrent sweeps miss the guard
 *     and skip the row.
 *   - Within a pass, per-target rows are attempted in order. A retryable
 *     failure bumps `retry_count` and sets `next_attempt_at` to
 *     `now + backoff`. When retry_count exceeds MAX_RETRIES the target is
 *     marked `failed` permanently.
 *   - After the pass, if any target is still `pending`, the broadcast row
 *     stays `dispatching` and `next_attempt_at` is set to the earliest
 *     target retry time. Otherwise the row finalizes to `completed` /
 *     `failed` based on the terminal-target counts.
 */

const PROCESSING_LOCK_SECONDS = 300; // 5 minutes — hard upper bound on one pass.
export const MAX_TARGET_RETRIES = 5;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
/** Guard against runaway per-pass loops; sweep will resume the rest on the next tick. */
const MAX_TARGETS_PER_PASS = 200;

export interface BroadcastRunResult {
    id: number;
    status: BroadcastRow["status"];
    dispatched: number;
    failed: number;
    pending: number;
    /** Populated when the pass finished but retries remain (unix seconds). */
    nextAttemptAt?: number;
    error?: string;
}

/**
 * Sweep one broadcast row through a single pass. Idempotent — if another
 * sweep has the lease we return `already_claimed` immediately.
 *
 * Callers pass the row as loaded by the cron query; only `id` is trusted
 * after the CAS claim re-reads the authoritative state.
 */
export async function runBroadcast(
    db: AppDatabase,
    bc: Pick<BroadcastRow, "id">,
    /** Required from code paths outside a fetch handler (see dispatcher). */
    env?: CloudflareEnv,
): Promise<BroadcastRunResult> {
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. CAS-claim the lease. Works for both fresh (`scheduled`) rows and
    //    in-progress (`dispatching`) rows whose earliest retry is due.
    const claim = await db
        .update(broadcasts)
        .set({
            status: "dispatching",
            startedAt: sql`COALESCE(${broadcasts.startedAt}, ${nowSec})`,
            nextAttemptAt: nowSec + PROCESSING_LOCK_SECONDS,
        })
        .where(
            and(
                eq(broadcasts.id, bc.id),
                or(eq(broadcasts.status, "scheduled"), eq(broadcasts.status, "dispatching")),
                lte(broadcasts.nextAttemptAt, nowSec),
            ),
        )
        .run();

    if (claim.meta.changes === 0) {
        // Someone else holds the lease, or the row is already terminal.
        const current = await db
            .select()
            .from(broadcasts)
            .where(eq(broadcasts.id, bc.id))
            .get();
        return {
            id: bc.id,
            status: current?.status ?? "cancelled",
            dispatched: current?.dispatchedCount ?? 0,
            failed: current?.failedCount ?? 0,
            pending: 0,
            error: "already_claimed",
        };
    }

    const claimed = await db
        .select()
        .from(broadcasts)
        .where(eq(broadcasts.id, bc.id))
        .get();
    if (!claimed) {
        return { id: bc.id, status: "failed", dispatched: 0, failed: 0, pending: 0, error: "row_missing" };
    }

    // 2. Re-parse the payload from persisted JSON. Never trust stored blobs.
    let payload;
    try {
        payload = outboundMessageSchema.parse(JSON.parse(claimed.payloadJson));
    } catch (err) {
        return finalize(db, claimed.id, "failed", err instanceof Error ? err.message : "invalid_payload");
    }

    // 3. Pick up all targets that are due right now.
    const dueTargets = await db
        .select()
        .from(broadcastTargets)
        .where(
            and(
                eq(broadcastTargets.broadcastId, claimed.id),
                eq(broadcastTargets.status, "pending"),
                or(isNull(broadcastTargets.nextAttemptAt), lte(broadcastTargets.nextAttemptAt, nowSec)),
            ),
        )
        .limit(MAX_TARGETS_PER_PASS)
        .all();

    let lastError: string | undefined;
    for (const target of dueTargets) {
        const attemptStart = Math.floor(Date.now() / 1000);
        const result = await dispatchOutboundMessage(db, {
            botId: claimed.botId,
            chatId: target.chatId,
            payload,
            env,
        });
        await recordTargetOutcome(db, target, result, attemptStart);
        if (!result.ok) lastError = describeFailure(result);
    }

    // 4. Recompute counts + earliest retry from the ledger.
    return recomputeBroadcast(db, claimed.id, lastError);
}

async function recordTargetOutcome(
    db: AppDatabase,
    target: BroadcastTargetRow,
    result: DispatchResult,
    attemptStart: number,
): Promise<void> {
    if (result.ok) {
        await db
            .update(broadcastTargets)
            .set({
                status: "sent",
                sentAt: attemptStart,
                attemptedAt: attemptStart,
                nextAttemptAt: null,
                messageId: result.messageId,
                failureReason: null,
            })
            .where(eq(broadcastTargets.id, target.id))
            .run();
        return;
    }

    const reason = describeFailure(result);
    const nextRetryCount = target.retryCount + 1;
    const canRetry = result.retryable && nextRetryCount <= MAX_TARGET_RETRIES;

    if (canRetry) {
        const backoffSec = backoffSeconds(nextRetryCount, result);
        await db
            .update(broadcastTargets)
            .set({
                status: "pending",
                retryCount: nextRetryCount,
                attemptedAt: attemptStart,
                nextAttemptAt: attemptStart + backoffSec,
                failureReason: reason,
            })
            .where(eq(broadcastTargets.id, target.id))
            .run();
        return;
    }

    await db
        .update(broadcastTargets)
        .set({
            status: "failed",
            retryCount: nextRetryCount,
            attemptedAt: attemptStart,
            nextAttemptAt: null,
            failureReason: reason,
        })
        .where(eq(broadcastTargets.id, target.id))
        .run();
}

/**
 * Refresh the denormalized counts on the broadcast row from the target
 * ledger and decide the next lifecycle transition:
 *   - Any pending targets remaining? Stay `dispatching`; lease released
 *     until the earliest retry becomes due (or immediately if there is
 *     more work to do right now).
 *   - No pending targets? Finalize to `completed` if any targets sent, or
 *     `failed` if every target ended in the failure state.
 */
async function recomputeBroadcast(
    db: AppDatabase,
    broadcastId: number,
    lastError: string | undefined,
): Promise<BroadcastRunResult> {
    const [sentRow, failedRow, pendingRow, earliest] = await Promise.all([
        db
            .select({ n: sql<number>`COUNT(*)` })
            .from(broadcastTargets)
            .where(and(eq(broadcastTargets.broadcastId, broadcastId), eq(broadcastTargets.status, "sent")))
            .get(),
        db
            .select({ n: sql<number>`COUNT(*)` })
            .from(broadcastTargets)
            .where(and(eq(broadcastTargets.broadcastId, broadcastId), eq(broadcastTargets.status, "failed")))
            .get(),
        db
            .select({ n: sql<number>`COUNT(*)` })
            .from(broadcastTargets)
            .where(and(eq(broadcastTargets.broadcastId, broadcastId), eq(broadcastTargets.status, "pending")))
            .get(),
        db
            .select({ next: min(broadcastTargets.nextAttemptAt) })
            .from(broadcastTargets)
            .where(and(eq(broadcastTargets.broadcastId, broadcastId), eq(broadcastTargets.status, "pending")))
            .get(),
    ]);

    const dispatched = sentRow?.n ?? 0;
    const failed = failedRow?.n ?? 0;
    const pending = pendingRow?.n ?? 0;

    if (pending > 0) {
        // Retry pass required. Release the lease so the next sweep picks it up
        // when the earliest target becomes due (or immediately for targets
        // that never received a nextAttemptAt).
        const nowSec = Math.floor(Date.now() / 1000);
        const nextAttemptAt = earliest?.next ?? nowSec;
        await db
            .update(broadcasts)
            .set({
                status: "dispatching",
                dispatchedCount: dispatched,
                failedCount: failed,
                lastError: lastError ?? null,
                nextAttemptAt,
            })
            .where(eq(broadcasts.id, broadcastId))
            .run();
        return {
            id: broadcastId,
            status: "dispatching",
            dispatched,
            failed,
            pending,
            nextAttemptAt,
            error: lastError,
        };
    }

    // Everything terminal — finalize.
    const finalStatus: BroadcastRow["status"] = dispatched === 0 && failed > 0 ? "failed" : "completed";
    const completedAt = Math.floor(Date.now() / 1000);
    await db
        .update(broadcasts)
        .set({
            status: finalStatus,
            dispatchedCount: dispatched,
            failedCount: failed,
            lastError: lastError ?? null,
            completedAt,
            // Park nextAttemptAt in the far future so it never re-enters the sweep.
            nextAttemptAt: completedAt + 60 * 60 * 24 * 365,
        })
        .where(eq(broadcasts.id, broadcastId))
        .run();

    return {
        id: broadcastId,
        status: finalStatus,
        dispatched,
        failed,
        pending: 0,
        error: lastError,
    };
}

async function finalize(
    db: AppDatabase,
    id: number,
    status: BroadcastRow["status"],
    lastError?: string,
): Promise<BroadcastRunResult> {
    const completedAt = Math.floor(Date.now() / 1000);
    await db
        .update(broadcasts)
        .set({
            status,
            lastError: lastError ?? null,
            completedAt,
            nextAttemptAt: completedAt + 60 * 60 * 24 * 365,
        })
        .where(eq(broadcasts.id, id))
        .run();
    return { id, status, dispatched: 0, failed: 0, pending: 0, error: lastError };
}

/**
 * Exponential backoff with ±15% jitter. If Telegram returned an explicit
 * `retry_after`, honor whichever is longer — undercutting a Telegram-imposed
 * pause invites a ban.
 */
function backoffSeconds(retryCount: number, result: DispatchResult): number {
    const expMs = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (retryCount - 1));
    const jitter = 0.85 + Math.random() * 0.3;
    const backoffMs = Math.floor(expMs * jitter);
    const backoffSec = Math.max(1, Math.ceil(backoffMs / 1000));

    if (!result.ok) {
        if (result.reason === "rate_limited") {
            const raSec = Math.ceil(result.retryAfterMs / 1000);
            return Math.max(backoffSec, raSec);
        }
        if (result.reason === "telegram_error" && result.retryAfterSeconds) {
            return Math.max(backoffSec, result.retryAfterSeconds);
        }
    }
    return backoffSec;
}

function describeFailure(
    fail: Exclude<DispatchResult, { ok: true }>,
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

/**
 * Query due broadcasts for the current sweep tick. Used by both the
 * Cloudflare Cron handler and the manual admin endpoint.
 */
export async function selectDueBroadcasts(
    db: AppDatabase,
    limit: number,
): Promise<BroadcastRow[]> {
    const nowSec = Math.floor(Date.now() / 1000);
    return db
        .select()
        .from(broadcasts)
        .where(
            and(
                or(eq(broadcasts.status, "scheduled"), eq(broadcasts.status, "dispatching")),
                lte(broadcasts.nextAttemptAt, nowSec),
                // Skip terminal rows whose future-parked nextAttemptAt would
                // otherwise never match; the OR above already restricts to
                // non-terminal states so this is just belt-and-braces.
                gt(broadcasts.nextAttemptAt, -1),
            ),
        )
        .limit(limit)
        .all();
}
