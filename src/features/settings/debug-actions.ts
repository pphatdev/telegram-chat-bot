"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, desc, eq } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import { bots, chats, messages, users } from "@/db/schema";
import { readSession } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import {
    TelegramApiError,
    TelegramClient,
    TelegramNetworkError,
    deriveWebhookSecret,
    registerBotWebhook,
    type WebhookInfo,
} from "@/lib/telegram";

/**
 * Debug diagnostics used exclusively by the Settings → Debug Logging panel.
 *
 * Every action re-verifies `users.debug_enabled` on the server — the UI
 * gates panel visibility client-side, but a determined caller could still
 * invoke the server action. Refusing when the flag is off prevents that.
 */

export type DebugResult<T> =
    | { ok: true; data: T }
    | {
          ok: false;
          error: string;
          code?:
              | "unauthenticated"
              | "not_found"
              | "debug_disabled"
              | "telegram_error"
              | "internal";
          errorCode?: number;
      };

export interface DebugBotIdentity {
    /** Our internal id. */
    id: number;
    /** Numeric Telegram bot id from getMe(). */
    telegramBotId: number;
    username: string;
    name: string;
}

export interface DebugMessagePreview {
    id: number;
    chatId: number;
    chatTitle: string;
    telegramMessageId: number | null;
    direction: "in" | "out";
    kind: string;
    text: string | null;
    status: string | null;
    failureReason: string | null;
    sentAt: number;
}

export interface DebugSnapshot {
    bot: DebugBotIdentity;
    webhookInfo: WebhookInfo | null;
    webhookInfoError: string | null;
    /**
     * Discriminates the class of failure so the UI can pick the right
     * troubleshooting hint. `network` means the fetch never reached
     * Telegram (DNS / connection / proxy); `telegram` means Telegram
     * responded with an error (bad token, wrong URL, etc.); `internal`
     * means our own code threw before or after the call.
     */
    webhookInfoErrorKind: "network" | "telegram" | "internal" | null;
    /**
     * The value of `env.PUBLIC_APP_URL` at snapshot time. The panel uses it
     * to flag common misconfigurations (missing, non-HTTPS, or trailing
     * slash mismatch) before the operator hits Re-register and gets a
     * cryptic Telegram error back.
     */
    publicAppUrl: string;
    recentInbound: DebugMessagePreview[];
    recentOutbound: DebugMessagePreview[];
}

type DebugContextError = {
    ok: false;
    error: string;
    code: "unauthenticated" | "not_found" | "debug_disabled";
};

type DebugContextOk = {
    ok: true;
    session: NonNullable<Awaited<ReturnType<typeof readSession>>>;
    db: Awaited<ReturnType<typeof getDbAsync>>;
    env: CloudflareEnv;
    bot: typeof bots.$inferSelect;
    passwordHash: string;
};

/**
 * Shared preamble for every debug action: resolves session, joins the
 * bot + owning user, and refuses when `debug_enabled` is false.
 *
 * Tagged with `ok: boolean` so callers can narrow via `if (!ctx.ok) return`
 * without TypeScript getting confused by the two-shape union.
 */
async function loadDebugContext(): Promise<DebugContextOk | DebugContextError> {
    const session = await readSession();
    if (!session) return { ok: false, error: "Not signed in", code: "unauthenticated" };

    const db = await getDbAsync();
    const row = await db
        .select({ bot: bots, debugEnabled: users.debugEnabled, passwordHash: users.passwordHash })
        .from(bots)
        .innerJoin(users, eq(users.id, bots.userId))
        .where(and(eq(bots.id, session.botId), eq(bots.userId, session.userId)))
        .get();
    if (!row) return { ok: false, error: "Bot not found", code: "not_found" };
    if (!row.debugEnabled) {
        return { ok: false, error: "Debug logging is not enabled", code: "debug_disabled" };
    }

    const { env } = await getCloudflareContext({ async: true });
    return { ok: true, session, db, env, bot: row.bot, passwordHash: row.passwordHash };
}

async function buildClient(bot: { id: number; username: string; encryptedToken: string }, secret: string) {
    const token = await decrypt(bot.encryptedToken, secret);
    return new TelegramClient({
        token,
        debug: true,
        debugLabel: `bot:${bot.id}${bot.username ? `:@${bot.username}` : ""}`,
    });
}

/**
 * One-shot snapshot for the debug panel: bot identity, Telegram's view of
 * the registered webhook, and the last few in/out messages so the operator
 * can see the round-trip working.
 *
 * getWebhookInfo failures are surfaced separately rather than fatal — the
 * DB slice of the snapshot is still useful even if Telegram is briefly
 * unreachable.
 */
export async function loadDebugSnapshot(): Promise<DebugResult<DebugSnapshot>> {
    const ctx = await loadDebugContext();
    if (!ctx.ok) return { ok: false, error: ctx.error, code: ctx.code };
    const { db, env, bot } = ctx;

    let webhookInfo: WebhookInfo | null = null;
    let webhookInfoError: string | null = null;
    let webhookInfoErrorKind: "network" | "telegram" | "internal" | null = null;
    try {
        const client = await buildClient(bot, env.ENCRYPTION_SECRET);
        webhookInfo = await client.getWebhookInfo();
    } catch (err) {
        if (err instanceof TelegramNetworkError) {
            webhookInfoError = err.cause;
            webhookInfoErrorKind = "network";
        } else if (err instanceof TelegramApiError) {
            webhookInfoError = `${err.errorCode}: ${err.description}`;
            webhookInfoErrorKind = "telegram";
        } else {
            webhookInfoError = err instanceof Error ? err.message : "unknown";
            webhookInfoErrorKind = "internal";
        }
    }

    const recent = await db
        .select({
            id: messages.id,
            chatId: messages.chatId,
            telegramMessageId: messages.telegramMessageId,
            direction: messages.direction,
            kind: messages.kind,
            text: messages.text,
            status: messages.status,
            failureReason: messages.failureReason,
            sentAt: messages.sentAt,
            chatTitle: chats.title,
        })
        .from(messages)
        .innerJoin(chats, eq(chats.id, messages.chatId))
        .where(eq(messages.botId, bot.id))
        .orderBy(desc(messages.sentAt))
        .limit(30)
        .all();

    const recentInbound: DebugMessagePreview[] = [];
    const recentOutbound: DebugMessagePreview[] = [];
    for (const row of recent) {
        const preview: DebugMessagePreview = {
            id: row.id,
            chatId: row.chatId,
            chatTitle: row.chatTitle,
            telegramMessageId: row.telegramMessageId,
            direction: row.direction,
            kind: row.kind,
            text: row.text,
            status: row.status,
            failureReason: row.failureReason,
            sentAt: row.sentAt,
        };
        if (row.direction === "in") {
            if (recentInbound.length < 10) recentInbound.push(preview);
        } else if (recentOutbound.length < 10) {
            recentOutbound.push(preview);
        }
    }

    return {
        ok: true,
        data: {
            bot: {
                id: bot.id,
                telegramBotId: bot.telegramBotId,
                username: bot.username,
                name: bot.name,
            },
            webhookInfo,
            webhookInfoError,
            webhookInfoErrorKind,
            publicAppUrl: env.PUBLIC_APP_URL ?? "",
            recentInbound,
            recentOutbound,
        },
    };
}

/**
 * Re-run `setWebhook` with the current per-bot derived secret. Useful when
 * Telegram lost the registration (e.g. after a tunnel URL change), or when
 * the operator wants to force a re-registration to clear a stale
 * `last_error_message` on the Telegram side.
 */
export async function reregisterBotWebhook(): Promise<DebugResult<{ url: string }>> {
    const ctx = await loadDebugContext();
    if (!ctx.ok) return { ok: false, error: ctx.error, code: ctx.code };
    const { env, bot, passwordHash } = ctx;

    if (!env.PUBLIC_APP_URL) {
        return {
            ok: false,
            error: "PUBLIC_APP_URL is not set — cannot re-register a webhook without a public URL",
            code: "internal",
        };
    }

    try {
        const client = await buildClient(bot, env.ENCRYPTION_SECRET);
        const secretToken = await deriveWebhookSecret(passwordHash, bot.id);
        await registerBotWebhook(client, {
            publicAppUrl: env.PUBLIC_APP_URL,
            botId: bot.id,
            secretToken,
        });
        const url = new URL(`/api/telegram/webhook/${bot.id}`, env.PUBLIC_APP_URL).toString();
        return { ok: true, data: { url } };
    } catch (err) {
        if (err instanceof TelegramNetworkError) {
            return { ok: false, error: `Network error: ${err.cause}`, code: "internal" };
        }
        if (err instanceof TelegramApiError) {
            return {
                ok: false,
                error: err.description,
                code: "telegram_error",
                errorCode: err.errorCode,
            };
        }
        return { ok: false, error: err instanceof Error ? err.message : "unknown", code: "internal" };
    }
}

/**
 * Ask Telegram to forget our webhook. Optionally drops the pending update
 * queue. After this call `getWebhookInfo` should return an empty `url` and
 * inbound events stop until `reregisterBotWebhook()` is called again.
 */
export async function deleteBotWebhook(
    dropPending = false,
): Promise<DebugResult<{ dropped: boolean }>> {
    const ctx = await loadDebugContext();
    if (!ctx.ok) return { ok: false, error: ctx.error, code: ctx.code };
    const { env, bot } = ctx;

    try {
        const client = await buildClient(bot, env.ENCRYPTION_SECRET);
        await client.deleteWebhook(dropPending);
        return { ok: true, data: { dropped: dropPending } };
    } catch (err) {
        if (err instanceof TelegramNetworkError) {
            return { ok: false, error: `Network error: ${err.cause}`, code: "internal" };
        }
        if (err instanceof TelegramApiError) {
            return {
                ok: false,
                error: err.description,
                code: "telegram_error",
                errorCode: err.errorCode,
            };
        }
        return { ok: false, error: err instanceof Error ? err.message : "unknown", code: "internal" };
    }
}

/**
 * Run `getMe` on demand. Fast round-trip that surfaces any token
 * revocation immediately — the auth-time cached identity might be stale
 * if @BotFather regenerated the token.
 */
export async function pingBot(): Promise<DebugResult<{ me: { id: number; username: string | null; first_name: string } }>> {
    const ctx = await loadDebugContext();
    if (!ctx.ok) return { ok: false, error: ctx.error, code: ctx.code };
    const { env, bot } = ctx;

    try {
        const client = await buildClient(bot, env.ENCRYPTION_SECRET);
        const me = await client.getMe();
        return {
            ok: true,
            data: {
                me: {
                    id: me.id,
                    username: me.username ?? null,
                    first_name: me.first_name,
                },
            },
        };
    } catch (err) {
        if (err instanceof TelegramNetworkError) {
            return { ok: false, error: `Network error: ${err.cause}`, code: "internal" };
        }
        if (err instanceof TelegramApiError) {
            return {
                ok: false,
                error: err.description,
                code: "telegram_error",
                errorCode: err.errorCode,
            };
        }
        return { ok: false, error: err instanceof Error ? err.message : "unknown", code: "internal" };
    }
}
