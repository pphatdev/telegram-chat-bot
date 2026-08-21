import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDbAsync } from "@/db/client";
import { bots, users } from "@/db/schema";
import { readSession } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import { persistTelegramUpdate } from "@/features/chats/persistence";
import { TelegramApiError, TelegramClient } from "@/lib/telegram";
import { telegramUpdateSchema } from "@/lib/telegram/schemas";

/**
 * POST /api/telegram/updates/[botId]
 *
 * Long-polling proxy for `getUpdates`. Meant for local dev where exposing a
 * public webhook via tunnel is inconvenient — the client can hit this
 * endpoint on an interval and each call drains the pending queue for the
 * bot.
 *
 * Not for production. If a webhook is registered against the bot, Telegram
 * refuses `getUpdates` with 409 Conflict.
 *
 * Pipeline:
 *   1. Session guard — only the bot's owner can trigger polling.
 *   2. Path segment must match a bot the session owns (defense in depth).
 *   3. Decrypt the token and call TelegramClient.getUpdates with
 *      { offset: bot.lastUpdateId + 1, timeout: 25 } for HTTP long-polling.
 *   4. Persist each update via persistTelegramUpdate — that helper also
 *      bumps `bots.lastUpdateId` atomically so re-entrant polls don't
 *      double-process.
 *
 * Debug: when the session's user has `debug_enabled=true`, every call() on
 * the client + every returned update is logged via the client's built-in
 * debug hook (see src/lib/telegram/client.ts).
 */
export async function POST(
    _request: Request,
    ctx: { params: Promise<{ botId: string }> },
) {
    const session = await readSession();
    if (!session) {
        return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }

    const { botId: botIdParam } = await ctx.params;
    const botId = Number.parseInt(botIdParam, 10);
    if (!Number.isFinite(botId) || botId !== session.botId) {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const db = await getDbAsync();
    const row = await db
        .select({ bot: bots, debugEnabled: users.debugEnabled })
        .from(bots)
        .innerJoin(users, eq(users.id, bots.userId))
        .where(and(eq(bots.id, botId), eq(bots.userId, session.userId)))
        .get();
    if (!row) {
        return NextResponse.json({ ok: false, error: "unknown_bot" }, { status: 404 });
    }
    const bot = row.bot;
    const debug = row.debugEnabled;

    const { env } = await getCloudflareContext({ async: true });
    const token = await decrypt(bot.encryptedToken, env.ENCRYPTION_SECRET);
    const client = new TelegramClient({
        token,
        debug,
        debugLabel: `bot:${bot.id}${bot.username ? `:@${bot.username}` : ""}`,
    });

    let raw;
    try {
        raw = await client.getUpdates({
            offset: bot.lastUpdateId + 1,
            timeout: 25,
            limit: 100,
        });
    } catch (err) {
        if (err instanceof TelegramApiError) {
            return NextResponse.json(
                { ok: false, error: "telegram_error", errorCode: err.errorCode, description: err.description },
                { status: 502 },
            );
        }
        return NextResponse.json(
            { ok: false, error: err instanceof Error ? err.message : "internal" },
            { status: 500 },
        );
    }

    let consumed = 0;
    let skipped = 0;
    for (const item of raw) {
        const parsed = telegramUpdateSchema.safeParse(item);
        if (!parsed.success) {
            // Malformed update — advance past it so we don't loop.
            skipped++;
            continue;
        }
        const result = await persistTelegramUpdate(db, bot.id, parsed.data);
        if (result.kind === "message") consumed++;
        else skipped++;
    }

    return NextResponse.json({ ok: true, consumed, skipped, batchSize: raw.length });
}

export function GET() {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
