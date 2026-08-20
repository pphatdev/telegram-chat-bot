import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { bots, chats, messages } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import {
    AccessDeniedError,
    assertBroadcastTargetAllowed,
    assertKeywordAllowed,
    assertStickerAllowed,
} from "@/lib/access-control/guards";
import { assertTelegramSendAllowed } from "@/lib/rate-limit/telegram";
import {
    TelegramApiError,
    TelegramClient,
    type InlineKeyboardMarkup,
} from "@/lib/telegram";
import type { OutboundMessagePayload } from "./schemas";

export type DispatchOk = {
    ok: true;
    messageId: number;
    telegramMessageId: number;
};

export type DispatchFail =
    | { ok: false; reason: "not_found" }
    | { ok: false; reason: "access_denied"; detail: string }
    | { ok: false; reason: "rate_limited"; retryAfterMs: number; bucket: "global" | "chat" }
    | { ok: false; reason: "telegram_error"; description: string; errorCode: number }
    | { ok: false; reason: "internal"; message: string };

export type DispatchResult = DispatchOk | DispatchFail;

export interface DispatchInput {
    botId: number;
    chatId: number;
    payload: OutboundMessagePayload;
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
 * scheduled-broadcast worker can persist per-target ledger entries without
 * try/catch noise.
 */
export async function dispatchOutboundMessage(
    db: AppDatabase,
    input: DispatchInput,
): Promise<DispatchResult> {
    const bot = await db
        .select()
        .from(bots)
        .where(eq(bots.id, input.botId))
        .get();
    if (!bot) return { ok: false, reason: "not_found" };

    const chat = await db
        .select()
        .from(chats)
        .where(and(eq(chats.id, input.chatId), eq(chats.botId, bot.id)))
        .get();
    if (!chat) return { ok: false, reason: "not_found" };

    try {
        const targetKey = chat.username ?? String(chat.telegramChatId);
        await assertBroadcastTargetAllowed(db, bot.id, targetKey);

        if (input.payload.kind === "text") {
            await assertKeywordAllowed(db, bot.id, input.payload.text);
        } else if (input.payload.kind === "photo" || input.payload.kind === "document") {
            if (input.payload.caption) {
                await assertKeywordAllowed(db, bot.id, input.payload.caption);
            }
        }
    } catch (err) {
        if (err instanceof AccessDeniedError) {
            return { ok: false, reason: "access_denied", detail: err.reason };
        }
        return {
            ok: false,
            reason: "internal",
            message: err instanceof Error ? err.message : "unknown_access_error",
        };
    }

    const rate = await assertTelegramSendAllowed(db, bot.id, chat.telegramChatId);
    if (!rate.allowed) {
        return {
            ok: false,
            reason: "rate_limited",
            retryAfterMs: rate.retryAfterMs,
            bucket: rate.bucket,
        };
    }

    const { env } = await getCloudflareContext({ async: true });
    const token = await decrypt(bot.encryptedToken, env.ENCRYPTION_SECRET);
    const client = new TelegramClient({ token });

    const now = Math.floor(Date.now() / 1000);
    let telegramMessageId: number;
    try {
        const sent = await sendViaTelegram(client, chat.telegramChatId, input.payload, env.PUBLIC_APP_URL);
        telegramMessageId = sent.message_id;
        // Sticker guard runs after Telegram assigns the file_id — for user-
        // supplied sticker payloads we'd guard beforehand, but the current
        // outbound schema doesn't yet include a sticker kind. Left here as
        // the extension point.
        void assertStickerAllowed;
    } catch (err) {
        const now2 = Math.floor(Date.now() / 1000);
        const failedRow = await db
            .insert(messages)
            .values({
                botId: bot.id,
                chatId: chat.id,
                direction: "out",
                kind: input.payload.kind,
                text: outboundText(input.payload),
                mediaR2Key: outboundMediaKey(input.payload),
                replyToMessageId: input.payload.replyToMessageId,
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
            };
        }
        return {
            ok: false,
            reason: "internal",
            message: `${err instanceof Error ? err.message : "send_failed"}${failedRow ? ` (row ${failedRow.id})` : ""}`,
        };
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
            replyToMessageId: input.payload.replyToMessageId,
            status: "sent",
            sentAt: now,
            createdAt: now,
        })
        .returning({ id: messages.id })
        .get();
    if (!inserted) {
        return { ok: false, reason: "internal", message: "row_insert_failed" };
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

    return { ok: true, messageId: inserted.id, telegramMessageId };
}

async function sendViaTelegram(
    client: TelegramClient,
    chatId: number,
    payload: OutboundMessagePayload,
    publicAppUrl: string,
) {
    const replyMarkup = payload.replyMarkup as InlineKeyboardMarkup | undefined;
    switch (payload.kind) {
        case "text":
            return client.sendMessage({
                chat_id: chatId,
                text: payload.text,
                parse_mode: payload.parseMode,
                reply_to_message_id: payload.replyToMessageId,
                disable_notification: payload.disableNotification,
                reply_markup: replyMarkup,
            });
        case "photo":
            return client.sendPhoto({
                chat_id: chatId,
                photo: r2PublicUrl(publicAppUrl, payload.mediaR2Key),
                caption: payload.caption,
                parse_mode: payload.parseMode,
                reply_to_message_id: payload.replyToMessageId,
                disable_notification: payload.disableNotification,
                reply_markup: replyMarkup,
            });
        case "document":
            return client.sendDocument({
                chat_id: chatId,
                document: r2PublicUrl(publicAppUrl, payload.mediaR2Key),
                caption: payload.caption,
                parse_mode: payload.parseMode,
                reply_to_message_id: payload.replyToMessageId,
                disable_notification: payload.disableNotification,
                reply_markup: replyMarkup,
            });
    }
}

function outboundText(p: OutboundMessagePayload): string | null {
    if (p.kind === "text") return p.text;
    return p.caption ?? null;
}

function outboundMediaKey(p: OutboundMessagePayload): string | null {
    if (p.kind === "photo" || p.kind === "document") return p.mediaR2Key;
    return null;
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
