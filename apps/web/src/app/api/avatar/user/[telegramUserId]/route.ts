import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDbAsync } from "@/db/context";
import { bots, users } from "@telegram-bot/shared/db/schema";
import { readSession } from "@/lib/auth/session";
import { decrypt } from "@telegram-bot/shared/crypto";
import { ensureUserAvatar } from "@telegram-bot/shared/telegram/avatar";
import { TelegramClient } from "@telegram-bot/shared/telegram";

/**
 * GET /api/avatar/user/[telegramUserId]
 *
 * Companion to `/api/avatar/chat/[chatId]` — resolves per-user avatars
 * shown next to message bubbles in group chats. Ownership scope here is
 * looser: any authenticated operator can request any Telegram user id
 * their bot could conceivably have seen. That's acceptable because:
 *   - The upstream Telegram call succeeds only when the bot itself has
 *     visibility of the user (shared group, private chat, etc.).
 *   - R2 keys are namespaced per bot, so cross-bot cache pollution isn't
 *     possible.
 *
 * The route returns the same 1×1 PNG fallback as the chat route on
 * miss / error so the UI never renders a broken-image glyph.
 */
export async function GET(
    _request: Request,
    ctx: { params: Promise<{ telegramUserId: string }> },
) {
    try {
        const session = await readSession();
        if (!session) return new NextResponse(null, { status: 401 });

        const { telegramUserId: userIdParam } = await ctx.params;
        const telegramUserId = Number.parseInt(userIdParam, 10);
        if (!Number.isFinite(telegramUserId) || telegramUserId <= 0) {
            return new NextResponse(null, { status: 400 });
        }

        const db = await getDbAsync();
        const bot = await db
            .select({
                id: bots.id,
                username: bots.username,
                encryptedToken: bots.encryptedToken,
                debugEnabled: users.debugEnabled,
            })
            .from(bots)
            .innerJoin(users, eq(users.id, bots.userId))
            .where(eq(bots.id, session.botId))
            .get();
        if (!bot) return new NextResponse(null, { status: 404 });

        const { env } = await getCloudflareContext({ async: true });
        const token = await decrypt(bot.encryptedToken, env.ENCRYPTION_SECRET);
        const client = new TelegramClient({
            token,
            debug: bot.debugEnabled,
            debugLabel: `bot:${bot.id}${bot.username ? `:@${bot.username}` : ""}`,
        });

        const result = await ensureUserAvatar(telegramUserId, {
            r2: env.R2,
            client,
            botId: bot.id,
        });

        if (result.notFound || !result.ok || !result.key) {
            return emptyAvatarResponse();
        }

        let object;
        try {
            object = await env.R2.get(result.key);
        } catch (err) {
            console.error(`[avatar] r2.get failed for user ${telegramUserId} key ${result.key}:`, err);
            return emptyAvatarResponse();
        }
        if (!object) return emptyAvatarResponse();

        const headers = new Headers();
        headers.set("Content-Type", object.httpMetadata?.contentType ?? "image/jpeg");
        headers.set("Content-Length", String(object.size));
        headers.set("ETag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
        return new Response(object.body, { status: 200, headers });
    } catch (err) {
        console.error("[avatar] unhandled user avatar route error:", err);
        return emptyAvatarResponse();
    }
}

function emptyAvatarResponse(): Response {
    return new NextResponse(TRANSPARENT_PNG, {
        status: 200,
        headers: {
            "Content-Type": "image/png",
            "Content-Length": String(TRANSPARENT_PNG.byteLength),
            "Cache-Control": "public, max-age=300",
        },
    });
}

const TRANSPARENT_PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
]);
