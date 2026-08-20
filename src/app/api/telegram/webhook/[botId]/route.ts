import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDbAsync } from "@/db/client";
import { bots } from "@/db/schema";
import { persistTelegramUpdate } from "@/features/chats/persistence";
import { telegramUpdateSchema } from "@/lib/telegram/schemas";
import { verifyWebhookSecret } from "@/lib/telegram/webhook";

/**
 * POST /api/telegram/webhook/[botId]
 *
 * Inbound receiver for Telegram Bot API callbacks. Telegram sends every
 * update to whatever URL was registered per bot via `setWebhook`, so the
 * `botId` path segment tells us which of our bots owns the update.
 *
 * Pipeline:
 *   1. Timing-safe compare `X-Telegram-Bot-Api-Secret-Token` against
 *      env.WEBHOOK_SECRET. Mismatch → 401 immediately, no body read.
 *      (Follow-up: derive per-bot secrets from ENCRYPTION_SECRET + botId
 *      when we support >1 bot per deployment.)
 *   2. Parse the JSON body against `telegramUpdateSchema`. Malformed →
 *      400 { error: "bad_json" | "invalid_update" }.
 *   3. Look up the bot row; unknown botId → 404.
 *   4. Persist via `persistTelegramUpdate` (upserts chat, inserts message,
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

    if (!verifyWebhookSecret(request.headers, env.WEBHOOK_SECRET)) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { botId: botIdParam } = await ctx.params;
    const botId = Number.parseInt(botIdParam, 10);
    if (!Number.isFinite(botId)) {
        return NextResponse.json({ ok: false, error: "invalid_bot_id" }, { status: 400 });
    }

    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
    }

    const parsed = telegramUpdateSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json(
            {
                ok: false,
                error: "invalid_update",
                issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
            },
            { status: 400 },
        );
    }

    const db = await getDbAsync();
    const bot = await db.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).get();
    if (!bot) {
        return NextResponse.json({ ok: false, error: "unknown_bot" }, { status: 404 });
    }

    const result = await persistTelegramUpdate(db, bot.id, parsed.data);

    // Fire-and-forget realtime notification. The webhook must return quickly
    // so Telegram doesn't retry; the DO broadcast is best-effort and its
    // failure never affects persistence (which already succeeded above).
    if (env.CHAT_FEED) {
        const stub = env.CHAT_FEED.get(env.CHAT_FEED.idFromName(String(bot.id)));
        workerCtx.waitUntil(stub.broadcast().catch(() => undefined));
    }

    return NextResponse.json({ ok: true, result });
}

export function GET() {
    return new NextResponse("Method Not Allowed", { status: 405 });
}
