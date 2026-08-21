"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDbAsync } from "@/db/client";
import {
    broadcastTargets,
    broadcasts,
    chats,
    type BroadcastRow,
} from "@/db/schema";
import { readSession } from "@/lib/auth/session";
import { dispatchOutboundMessage } from "./dispatcher";
import { outboundMessageSchema } from "./schemas";
import { runBroadcast } from "./sweep";

export type SendResult =
    | {
          ok: true;
          messageId: number;
          telegramMessageId: number;
          /** True when the caller's reply target was gone (deleted from
           *  Telegram) and we resent as a plain message. Clients should
           *  surface a note so the sender knows the reply was dropped. */
          replyDropped?: true;
      }
    | { ok: false; error: string; code?: string; retryAfterMs?: number };

export type BroadcastCreateResult =
    | { ok: true; broadcastId: number; runAt: number; duplicate?: boolean }
    | { ok: false; error: string; code?: string };

export type BroadcastDispatchResult =
    | { ok: true; dispatched: number; failed: number; pending: number; status: BroadcastRow["status"] }
    | { ok: false; error: string; code?: string };

export type BroadcastListResult =
    | { ok: true; data: BroadcastRow[] }
    | { ok: false; error: string; code?: string };

const createBroadcastInputSchema = z.object({
    payload: outboundMessageSchema,
    targetChatIds: z.array(z.number().int().positive()).min(1).max(500),
    /** Unix seconds. Missing/past values run at the next sweep tick. */
    runAt: z.number().int().positive().optional(),
    /**
     * Client-supplied de-duplication key. If a broadcast with the same
     * `(botId, idempotencyKey)` already exists we short-circuit and return
     * that broadcastId — safe for React StrictMode double-invokes, retried
     * form submissions, and PWA re-mounts.
     */
    idempotencyKey: z.string().min(1).max(120).optional(),
});

/**
 * Send a single message to the given chat (composer's Send button).
 * See `dispatchOutboundMessage` for the guardrails.
 */
export async function sendChatMessage(
    chatId: number,
    payload: unknown,
): Promise<SendResult> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const parsed = outboundMessageSchema.safeParse(payload);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues[0]?.message ?? "Invalid payload",
            code: "invalid_payload",
        };
    }

    const db = await getDbAsync();
    const chat = await db
        .select({ id: chats.id })
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.botId, session.botId)))
        .get();
    if (!chat) return { ok: false, error: "Chat not found", code: "not_found" };

    const result = await dispatchOutboundMessage(db, {
        botId: session.botId,
        chatId: chat.id,
        payload: parsed.data,
    });

    if (result.ok) {
        return {
            ok: true,
            messageId: result.messageId,
            telegramMessageId: result.telegramMessageId,
            ...(result.replyDropped && { replyDropped: true as const }),
        };
    }
    return userFacingSendError(result);
}

/**
 * Persist a new broadcast row targeting many chats.
 *
 * All target chat IDs must belong to the session's bot — enforced with a
 * single `WHERE botId = session.botId AND id IN (...)` fetch. If any target
 * ID doesn't resolve we reject the whole request rather than silently
 * dropping — safer for large fan-outs where partial acceptance is worse
 * than a clear error.
 *
 * Idempotency: if the caller supplies an `idempotencyKey` we look up the
 * existing row on `(bot_id, idempotency_key)` first and return it unchanged.
 * A missing key generates a random UUID so every call still lands in a
 * unique slot.
 *
 * `runAt` semantics:
 *   - Omitted or in the past → treat as "eligible now"; the cron sweep will
 *     pick it up (or the caller can immediately fire `dispatchBroadcastNow`).
 *   - Future timestamp → dispatched on the first sweep after runAt.
 */
export async function createBroadcast(input: unknown): Promise<BroadcastCreateResult> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const parsed = createBroadcastInputSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            error: parsed.error.issues[0]?.message ?? "Invalid broadcast",
            code: "invalid_payload",
        };
    }

    const db = await getDbAsync();

    // Idempotency short-circuit: if the caller provided a key that already
    // exists for this bot, return the existing row instead of creating a
    // second one. Race-safe because the unique index catches the insert
    // path too (see below).
    if (parsed.data.idempotencyKey) {
        const existing = await db
            .select({ id: broadcasts.id, runAt: broadcasts.runAt })
            .from(broadcasts)
            .where(
                and(
                    eq(broadcasts.botId, session.botId),
                    eq(broadcasts.idempotencyKey, parsed.data.idempotencyKey),
                ),
            )
            .get();
        if (existing) {
            return { ok: true, broadcastId: existing.id, runAt: existing.runAt, duplicate: true };
        }
    }

    const ownedRows = await db
        .select({ id: chats.id })
        .from(chats)
        .where(and(eq(chats.botId, session.botId), inArray(chats.id, parsed.data.targetChatIds)))
        .all();
    const ownedIds = new Set(ownedRows.map((r) => r.id));
    const missing = parsed.data.targetChatIds.filter((id) => !ownedIds.has(id));
    if (missing.length > 0) {
        return {
            ok: false,
            error: `Chat${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not found for this bot`,
            code: "target_not_found",
        };
    }

    const now = Math.floor(Date.now() / 1000);
    const runAt = parsed.data.runAt ?? now;
    const idempotencyKey = parsed.data.idempotencyKey ?? crypto.randomUUID();

    // Insert the broadcast row. If a concurrent request wins the idempotency
    // race, the unique index rejects our insert and we recover by fetching
    // the winner.
    let insertedId: number | undefined;
    try {
        const inserted = await db
            .insert(broadcasts)
            .values({
                botId: session.botId,
                idempotencyKey,
                payloadJson: JSON.stringify(parsed.data.payload),
                targetsJson: JSON.stringify(parsed.data.targetChatIds.map((chatId) => ({ chatId }))),
                status: "scheduled",
                runAt,
                nextAttemptAt: runAt,
                dispatchedCount: 0,
                failedCount: 0,
                createdAt: now,
            })
            .returning({ id: broadcasts.id })
            .get();
        insertedId = inserted?.id;
    } catch {
        // Unique-index collision — recover by returning the existing row.
        const existing = await db
            .select({ id: broadcasts.id, runAt: broadcasts.runAt })
            .from(broadcasts)
            .where(
                and(
                    eq(broadcasts.botId, session.botId),
                    eq(broadcasts.idempotencyKey, idempotencyKey),
                ),
            )
            .get();
        if (existing) {
            return { ok: true, broadcastId: existing.id, runAt: existing.runAt, duplicate: true };
        }
        return { ok: false, error: "Failed to persist broadcast", code: "internal" };
    }

    if (!insertedId) return { ok: false, error: "Failed to persist broadcast", code: "internal" };

    // Explode the target list into per-target ledger rows so the sweep can
    // track each dispatch independently. This is the source of truth for
    // delivery state — `broadcasts.dispatchedCount`/`failedCount` are just
    // denormalized aggregates refreshed at the end of every sweep pass.
    await db
        .insert(broadcastTargets)
        .values(
            parsed.data.targetChatIds.map((chatId) => ({
                broadcastId: insertedId!,
                chatId,
                status: "pending" as const,
                retryCount: 0,
                createdAt: now,
            })),
        )
        .run();

    return { ok: true, broadcastId: insertedId, runAt };
}

/**
 * Dispatch a broadcast immediately, bypassing the cron sweep. Runs the
 * exact same `runBroadcast` sweep helper so guardrails are identical.
 */
export async function dispatchBroadcastNow(broadcastId: number): Promise<BroadcastDispatchResult> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const db = await getDbAsync();
    const bc = await db
        .select({ id: broadcasts.id, status: broadcasts.status, botId: broadcasts.botId })
        .from(broadcasts)
        .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.botId, session.botId)))
        .get();
    if (!bc) return { ok: false, error: "Broadcast not found", code: "not_found" };
    if (bc.status === "cancelled" || bc.status === "completed" || bc.status === "failed") {
        return { ok: false, error: `Broadcast is already ${bc.status}`, code: "invalid_state" };
    }

    const result = await runBroadcast(db, { id: bc.id });
    if (result.error === "already_claimed") {
        return { ok: false, error: "Broadcast is already being dispatched", code: "invalid_state" };
    }
    return {
        ok: true,
        dispatched: result.dispatched,
        failed: result.failed,
        pending: result.pending,
        status: result.status,
    };
}

/**
 * Cancel a scheduled broadcast before the cron sweep picks it up.
 * Only rows still in `scheduled` state are cancellable — once a broadcast
 * has entered `dispatching` we can't reliably interrupt the target loop.
 */
export async function cancelBroadcast(broadcastId: number): Promise<BroadcastDispatchResult> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };
    const db = await getDbAsync();
    const now = Math.floor(Date.now() / 1000);
    const result = await db
        .update(broadcasts)
        .set({
            status: "cancelled",
            completedAt: now,
            // Park nextAttemptAt in the future so a stale sweep never
            // resurrects the cancelled row.
            nextAttemptAt: now + 60 * 60 * 24 * 365,
        })
        .where(
            and(
                eq(broadcasts.id, broadcastId),
                eq(broadcasts.botId, session.botId),
                eq(broadcasts.status, "scheduled"),
            ),
        )
        .run();
    if (result.meta.changes === 0) {
        return {
            ok: false,
            error: "Broadcast is not in a cancellable state",
            code: "invalid_state",
        };
    }
    return { ok: true, dispatched: 0, failed: 0, pending: 0, status: "cancelled" };
}

export async function listBroadcasts(limit = 50): Promise<BroadcastListResult> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };
    const db = await getDbAsync();
    const rows = await db
        .select()
        .from(broadcasts)
        .where(eq(broadcasts.botId, session.botId))
        .orderBy(desc(broadcasts.createdAt))
        .limit(Math.min(limit, 200))
        .all();
    return { ok: true, data: rows };
}

function userFacingSendError(
    fail: Exclude<Awaited<ReturnType<typeof dispatchOutboundMessage>>, { ok: true }>,
): SendResult {
    switch (fail.reason) {
        case "not_found":
            return { ok: false, error: "Chat or bot not found", code: "not_found" };
        case "access_denied":
            return { ok: false, error: `Blocked by ${fail.detail}`, code: "access_denied" };
        case "rate_limited":
            return {
                ok: false,
                error: `Rate limited on ${fail.bucket} bucket`,
                code: "rate_limited",
                retryAfterMs: fail.retryAfterMs,
            };
        case "telegram_error":
            return {
                ok: false,
                error: `Telegram rejected the message (${fail.errorCode}): ${fail.description}`,
                code: "telegram_error",
            };
        case "internal":
            return { ok: false, error: fail.message, code: "internal" };
    }
}
