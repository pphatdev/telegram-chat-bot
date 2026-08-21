import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDbAsync } from "@/db/client";
import { bots, users } from "@/db/schema";
import { persistTelegramUpdate } from "@/features/chats/persistence";
import { telegramUpdateSchema } from "@/lib/telegram/schemas";
import {
    deriveWebhookSecret,
    timingSafeEqual,
    WEBHOOK_SECRET_HEADER,
} from "@/lib/telegram/webhook";

/**
 * POST /api/telegram/webhook/[botId]
 *
 * Inbound receiver for Telegram Bot API callbacks. Telegram sends every
 * update to whatever URL was registered per bot via `setWebhook`, so the
 * `botId` path segment tells us which of our bots owns the update.
 *
 * Pipeline:
 *   1. Cheap header presence check — reject early if the caller didn't
 *      even bother sending `X-Telegram-Bot-Api-Secret-Token`.
 *   2. Parse botId; unknown/missing → 400/404 before any body read.
 *   3. Look up the bot + owning user's passwordHash and derive the
 *      expected secret via `deriveWebhookSecret`. Timing-safe compare
 *      against the header. Mismatch → 401.
 *   4. Parse the JSON body against `telegramUpdateSchema`. Malformed →
 *      400 { error: "bad_json" | "invalid_update" }.
 *   5. Persist via `persistTelegramUpdate` (upserts chat, inserts message,
 *      bumps lastUpdateId).
 *
 * Telegram retries on any non-2xx, so we return 200 for anything we've
 * consumed — even "skipped" updates count as consumed since we've advanced
 * the offset cursor.
 */
export async function POST(
    request: Request,
    ctx: { params: Promise<{ botId: string }> },
) {
    const { env, ctx: workerCtx } = await getCloudflareContext({ async: true });

    const provided = request.headers.get(WEBHOOK_SECRET_HEADER);
    if (!provided) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { botId: botIdParam } = await ctx.params;
    const botId = Number.parseInt(botIdParam, 10);
    if (!Number.isFinite(botId) || botId <= 0) {
        return NextResponse.json({ ok: false, error: "invalid_bot_id" }, { status: 400 });
    }

    const db = await getDbAsync();
    const bot = await db
        .select({
            id: bots.id,
            username: bots.username,
            passwordHash: users.passwordHash,
            debugEnabled: users.debugEnabled,
        })
        .from(bots)
        .innerJoin(users, eq(users.id, bots.userId))
        .where(eq(bots.id, botId))
        .get();
    if (!bot) {
        // Return 401 (not 404) so probing the endpoint can't enumerate
        // registered botIds via response-code differences.
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const expected = await deriveWebhookSecret(bot.passwordHash, bot.id);
    if (!timingSafeEqual(provided, expected)) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
    }

    const parsed = telegramUpdateSchema.safeParse(raw);
    if (!parsed.success) {
        if (bot.debugEnabled) {
            console.log(
                `[tg:debug] bot:${bot.id}${bot.username ? `:@${bot.username}` : ""} ← webhook invalid_update`,
                JSON.stringify(raw),
            );
        }
        return NextResponse.json(
            {
                ok: false,
                error: "invalid_update",
                issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
            },
            { status: 400 },
        );
    }

    const debugLabel = `bot:${bot.id}${bot.username ? `:@${bot.username}` : ""}`;
    if (bot.debugEnabled) {
        console.log(`[tg:debug] ${debugLabel} ← webhook update`, JSON.stringify(parsed.data));
    }

    let result;
    try {
        result = await persistTelegramUpdate(db, bot.id, parsed.data);
    } catch (err) {
        // ALWAYS log the failure — even without debug enabled — because
        // Telegram retry-storms non-2xx responses (fresh update every
        // second until either we accept it or 24h elapse). Silent bugs
        // here have blown out D1 read budgets in the past.
        console.error(
            `[webhook] ${debugLabel} × persistTelegramUpdate failed for update_id=${parsed.data.update_id}:`,
            err,
        );
        // Return 200 so Telegram considers the update delivered and stops
        // retrying. We've captured the update_id + full stack in logs, and
        // `bots.lastUpdateId` won't advance (because persist threw before
        // bumping it) — but Telegram uses webhook delivery, not offsets,
        // so nothing is dropped from an operator's POV.
        return NextResponse.json(
            {
                ok: false,
                error: "persist_failed",
                detail: err instanceof Error ? err.message : "unknown",
            },
            { status: 200 },
        );
    }

    // Fire-and-forget realtime notification. The webhook must return quickly
    // so Telegram doesn't retry; the DO broadcast is best-effort and its
    // failure never affects persistence (which already succeeded above).
    if (env.CHAT_FEED) {
        try {
            const stub = env.CHAT_FEED.get(env.CHAT_FEED.idFromName(String(bot.id)));
            workerCtx.waitUntil(
                stub.broadcast().catch((err) => {
                    console.error(`[webhook] ${debugLabel} × chat-feed broadcast failed:`, err);
                }),
            );
        } catch (err) {
            // env.CHAT_FEED can be defined-but-broken in `next dev` where the
            // DO binding isn't provisioned by workerd. Log and continue —
            // the polling fallback in use-chat-feed.ts covers this case.
            console.error(`[webhook] ${debugLabel} × chat-feed stub setup failed:`, err);
        }
    }

    return NextResponse.json({ ok: true, result });
}

export function GET() {
    return new NextResponse("Method Not Allowed", { status: 405 });
}
