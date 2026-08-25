import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@telegram-bot/shared/db";
import { bots, chats, messages, users } from "@telegram-bot/shared/db/schema";
import { decrypt } from "@telegram-bot/shared/crypto";
import {
    AccessDeniedError,
    assertBroadcastTargetAllowed,
    assertKeywordAllowed,
    assertStickerAllowed,
} from "@telegram-bot/shared/access-control/guards";
import { assertTelegramSendAllowed } from "@telegram-bot/shared/rate-limit/telegram";
import {
    TelegramApiError,
    TelegramClient,
    type InlineKeyboardMarkup,
} from "@telegram-bot/shared/telegram";
import type { OutboundMessagePayload } from "@telegram-bot/shared/schemas/broadcast";

export type DispatchOk = {
    ok: true;
    messageId: number;
    telegramMessageId: number;
    /**
     * True when we had to drop the caller's `replyToMessageId` and resend as
     * a non-reply because Telegram returned "message to be replied not found"
     * (the parent was deleted from the chat). Callers can surface a note to
     * the user; not an error path.
     */
    replyDropped?: true;
};

/**
 * Detect Telegram's "the message you're replying to no longer exists" error.
 * Telegram returns HTTP 400 with a descriptive string — the exact wording
 * has drifted historically ("message to be replied not found", "replied
 * message not found") so we match a broad substring rather than an exact
 * string. Not part of `TelegramApiError.isRetryable` because plain retrying
 * would fail identically — this is a "retry without the reply field" case.
 */
function isReplyTargetMissingError(err: unknown): boolean {
    if (!(err instanceof TelegramApiError)) return false;
    if (err.errorCode !== 400) return false;
    const d = err.description.toLowerCase();
    return d.includes("replied") && d.includes("not found");
}

export type DispatchFail =
    | { ok: false; reason: "not_found"; retryable: false }
    | { ok: false; reason: "access_denied"; detail: string; retryable: false }
    | {
          ok: false;
          reason: "rate_limited";
          retryAfterMs: number;
          bucket: "global" | "chat";
          retryable: true;
      }
    | {
          ok: false;
          reason: "telegram_error";
          description: string;
          errorCode: number;
          retryable: boolean;
          /** Populated when Telegram's response included `parameters.retry_after`. */
          retryAfterSeconds?: number;
      }
    | { ok: false; reason: "internal"; message: string; retryable: false };

export type DispatchResult = DispatchOk | DispatchFail;

export interface DispatchInput {
    botId: number;
    chatId: number;
    payload: OutboundMessagePayload;
    /**
     * Cloudflare env bindings. Required from code paths that don't run
     * inside a fetch handler (e.g. the `scheduled()` cron export). Omit on
     * request-driven paths — we'll pull env from OpenNext's context.
     */
    env?: CloudflareEnv;
}

/**
 * Send a single outbound message with all safety rails.
 *
 * Order matters:
 *   1. Load bot + chat (fail fast on missing rows).
 *   2. Allowlist / blocklist / keyword / sticker guards — cheapest checks
 *      first, before any external calls.
 *   3. Token-bucket rate limit — per-chat 1/s AND global 30/s. On rejection
 *      we record NO outbound row (nothing was attempted); callers should
 *      back off `retryAfterMs` and retry.
 *   4. Decrypt bot token (AES-GCM-256) and call the Telegram API.
 *   5. Persist an outbound Message row — status `sent` on success,
 *      `failed` + `failureReason` on TelegramApiError.
 *
 * All exceptions are converted to typed `DispatchFail` results so the
 * broadcast sweep can persist per-target ledger entries without try/catch
 * noise. The `retryable` field tells callers whether it's safe to schedule
 * a backoff retry (rate-limits and Telegram 429/5xx) or whether the failure
 * is permanent (blacklist, missing chat, invalid payload).
 */
export async function dispatchOutboundMessage(
    db: AppDatabase,
    input: DispatchInput,
): Promise<DispatchResult> {
    const botRow = await db
        .select({ bot: bots, debugEnabled: users.debugEnabled })
        .from(bots)
        .innerJoin(users, eq(users.id, bots.userId))
        .where(eq(bots.id, input.botId))
        .get();
    if (!botRow) return { ok: false, reason: "not_found", retryable: false };
    const bot = botRow.bot;
    const debug = botRow.debugEnabled;

    const chat = await db
        .select()
        .from(chats)
        .where(and(eq(chats.id, input.chatId), eq(chats.botId, bot.id)))
        .get();
    if (!chat) return { ok: false, reason: "not_found", retryable: false };

    try {
        const targetKey = chat.username ?? String(chat.telegramChatId);
        await assertBroadcastTargetAllowed(db, bot.id, targetKey);

        switch (input.payload.kind) {
            case "text":
                await assertKeywordAllowed(db, bot.id, input.payload.text);
                break;
            case "photo":
            case "document":
            case "video":
            case "audio":
                if (input.payload.caption) {
                    await assertKeywordAllowed(db, bot.id, input.payload.caption);
                }
                break;
            case "sticker":
                await assertStickerAllowed(db, bot.id, input.payload.stickerRef);
                break;
        }
    } catch (err) {
        if (err instanceof AccessDeniedError) {
            return { ok: false, reason: "access_denied", detail: err.reason, retryable: false };
        }
        return {
            ok: false,
            reason: "internal",
            message: err instanceof Error ? err.message : "unknown_access_error",
            retryable: false,
        };
    }

    const rate = await assertTelegramSendAllowed(db, bot.id, chat.telegramChatId);
    if (!rate.allowed) {
        return {
            ok: false,
            reason: "rate_limited",
            retryAfterMs: rate.retryAfterMs,
            bucket: rate.bucket,
            retryable: true,
        };
    }

    const env = input.env ?? (await getCloudflareContext({ async: true })).env;
    const token = await decrypt(bot.encryptedToken, env.ENCRYPTION_SECRET);
    const client = new TelegramClient({
        token,
        debug,
        debugLabel: `bot:${bot.id}${bot.username ? `:@${bot.username}` : ""}`,
    });

    const now = Math.floor(Date.now() / 1000);
    let telegramMessageId: number;
    // Mutable copy so we can strip `replyToMessageId` if the parent was
    // deleted and we retry as a plain (non-reply) send. Everything else on
    // the payload — text, media, keyboard — stays identical.
    let effectivePayload: OutboundMessagePayload = input.payload;
    let replyDropped: true | undefined;
    try {
        const sent = await sendViaTelegram(client, chat.telegramChatId, effectivePayload, env.PUBLIC_APP_URL);
        telegramMessageId = sent.message_id;
    } catch (err) {
        // Reply target was deleted from Telegram's side. The user's intent
        // (send this message to this chat) is still valid — just not as a
        // reply. Retry once with `replyToMessageId` stripped so the message
        // still lands. If the retry also fails, fall through to the normal
        // failure path.
        if (
            isReplyTargetMissingError(err) &&
            input.payload.replyToMessageId !== undefined &&
            input.payload.replyToMessageId !== null
        ) {
            try {
                effectivePayload = { ...input.payload, replyToMessageId: undefined } as OutboundMessagePayload;
                const sent = await sendViaTelegram(client, chat.telegramChatId, effectivePayload, env.PUBLIC_APP_URL);
                telegramMessageId = sent.message_id;
                replyDropped = true;
            } catch (retryErr) {
                return recordSendFailure(db, bot.id, chat.id, input.payload, retryErr);
            }
        } else {
            return recordSendFailure(db, bot.id, chat.id, input.payload, err);
        }
    }

    const inserted = await db
        .insert(messages)
        .values({
            botId: bot.id,
            chatId: chat.id,
            telegramMessageId,
            direction: "out",
            kind: input.payload.kind,
            text: outboundText(input.payload),
            mediaR2Key: outboundMediaKey(input.payload),
            // Persist the *effective* reply target — if we dropped it because
            // the parent was deleted, the stored row shouldn't claim to be a
            // reply either (the reply-chip lookup in chat-pane would show a
            // phantom preview otherwise).
            replyToMessageId: effectivePayload.replyToMessageId,
            status: "sent",
            sentAt: now,
            createdAt: now,
        })
        .returning({ id: messages.id })
        .get();
    if (!inserted) {
        return { ok: false, reason: "internal", message: "row_insert_failed", retryable: false };
    }

    // Reflect the outbound in the chat sidebar preview.
    await db
        .update(chats)
        .set({
            lastMessageText: outboundText(input.payload) ?? outboundMediaKey(input.payload),
            lastMessageAt: now,
            updatedAt: now,
        })
        .where(eq(chats.id, chat.id))
        .run();

    return { ok: true, messageId: inserted.id, telegramMessageId, ...(replyDropped && { replyDropped }) };
}

/**
 * Persist a `status: 'failed'` row for a send that couldn't complete, and
 * translate the underlying error into a `DispatchFail`. Extracted so both
 * the initial send and the reply-dropped retry can share the same tail.
 */
async function recordSendFailure(
    db: AppDatabase,
    botId: number,
    chatId: number,
    payload: OutboundMessagePayload,
    err: unknown,
): Promise<DispatchFail> {
    const now2 = Math.floor(Date.now() / 1000);
    const failedRow = await db
        .insert(messages)
        .values({
            botId,
            chatId,
            direction: "out",
            kind: payload.kind,
            text: outboundText(payload),
            mediaR2Key: outboundMediaKey(payload),
            replyToMessageId: payload.replyToMessageId,
            status: "failed",
            failureReason:
                err instanceof TelegramApiError
                    ? `${err.errorCode}: ${err.description}`
                    : err instanceof Error ? err.message : "unknown",
            sentAt: now2,
            createdAt: now2,
        })
        .returning({ id: messages.id })
        .get();

    if (err instanceof TelegramApiError) {
        return {
            ok: false,
            reason: "telegram_error",
            errorCode: err.errorCode,
            description: err.description,
            retryable: err.isRetryable,
            retryAfterSeconds: err.retryAfterSeconds,
        };
    }
    return {
        ok: false,
        reason: "internal",
        message: `${err instanceof Error ? err.message : "send_failed"}${failedRow ? ` (row ${failedRow.id})` : ""}`,
        retryable: false,
    };
}

async function sendViaTelegram(
    client: TelegramClient,
    chatId: number,
    payload: OutboundMessagePayload,
    publicAppUrl: string,
) {
    const replyMarkup = payload.replyMarkup as InlineKeyboardMarkup | undefined;
    const common = {
        chat_id: chatId,
        reply_to_message_id: payload.replyToMessageId,
        disable_notification: payload.disableNotification,
        reply_markup: replyMarkup,
    };
    switch (payload.kind) {
        case "text":
            return client.sendMessage({
                ...common,
                text: payload.text,
                parse_mode: payload.parseMode,
            });
        case "photo":
            return client.sendPhoto({
                ...common,
                photo: r2PublicUrl(publicAppUrl, payload.mediaR2Key),
                caption: payload.caption,
                parse_mode: payload.parseMode,
            });
        case "document":
            return client.sendDocument({
                ...common,
                document: r2PublicUrl(publicAppUrl, payload.mediaR2Key),
                caption: payload.caption,
                parse_mode: payload.parseMode,
            });
        case "video":
            return client.sendVideo({
                ...common,
                video: r2PublicUrl(publicAppUrl, payload.mediaR2Key),
                caption: payload.caption,
                parse_mode: payload.parseMode,
                duration: payload.duration,
                width: payload.width,
                height: payload.height,
                supports_streaming: payload.supportsStreaming,
            });
        case "audio":
            return client.sendAudio({
                ...common,
                audio: r2PublicUrl(publicAppUrl, payload.mediaR2Key),
                caption: payload.caption,
                parse_mode: payload.parseMode,
                duration: payload.duration,
                performer: payload.performer,
                title: payload.title,
            });
        case "sticker":
            return client.sendSticker({
                ...common,
                sticker: payload.stickerRef,
                emoji: payload.emoji,
            });
    }
}

function outboundText(p: OutboundMessagePayload): string | null {
    if (p.kind === "text") return p.text;
    if (p.kind === "sticker") return p.emoji ?? null;
    return p.caption ?? null;
}

function outboundMediaKey(p: OutboundMessagePayload): string | null {
    switch (p.kind) {
        case "photo":
        case "document":
        case "video":
        case "audio":
            return p.mediaR2Key;
        case "sticker":
            return p.stickerRef;
        default:
            return null;
    }
}

/**
 * Compose a public-facing URL Telegram can fetch for our media proxy.
 *
 * We route through `/api/media/[...key]` rather than exposing the R2 bucket
 * directly — that keeps bucket config trivial (no public custom domain
 * required) and lets us add rate-limits or signed URLs later without
 * breaking Telegram-side references.
 *
 * `publicAppUrl` is `env.PUBLIC_APP_URL` — the public origin the Worker is
 * reachable at. In dev this is a Cloudflare Tunnel / ngrok URL; in prod the
 * deployed workers.dev / custom domain. If missing, we throw eagerly so we
 * never hand Telegram a broken URL.
 */
function r2PublicUrl(publicAppUrl: string, key: string): string {
    if (!publicAppUrl) {
        throw new Error(
            "PUBLIC_APP_URL is not set — media broadcasts cannot construct a fetchable URL",
        );
    }
    const trimmed = publicAppUrl.replace(/\/+$/, "");
    return `${trimmed}/api/media/${key}`;
}
