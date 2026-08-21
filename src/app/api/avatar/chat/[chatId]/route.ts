import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDbAsync } from "@/db/client";
import { bots, chats, users } from "@/db/schema";
import { readSession } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import { ensureChatAvatar } from "@/lib/telegram/avatar";
import { TelegramClient } from "@/lib/telegram";

/**
 * GET /api/avatar/chat/[chatId]
 *
 * Session-guarded lazy avatar proxy. On first hit for a chat we:
 *   1. Join `chats` → `bots` → `users` scoped to the session's bot to
 *      confirm ownership.
 *   2. Decrypt the bot token and call `ensureChatAvatar`, which fetches
 *      from Telegram + persists into R2 under a stable key.
 *   3. Stream the object body out with a long immutable Cache-Control so
 *      browsers reuse it without re-hitting us.
 *
 * The `?v=<version>` query is a cache-busting knob for the UI — callers
 * can append `?v=Date.now()` after a manual refresh to force a browser
 * reload. The server ignores the value; it's just for the browser cache.
 *
 * On 404 (chat has no photo) we return a small transparent SVG so the
 * `<img>` tag never shows a broken-image glyph — the colored-initials
 * background stays visible as a natural fallback.
 */
export async function GET(
    _request: Request,
    ctx: { params: Promise<{ chatId: string }> },
) {
    try {
        const session = await readSession();
        if (!session) return new NextResponse(null, { status: 401 });

        const { chatId: chatIdParam } = await ctx.params;
        const chatId = Number.parseInt(chatIdParam, 10);
        if (!Number.isFinite(chatId)) return new NextResponse(null, { status: 400 });

        const db = await getDbAsync();
        const row = await db
            .select({
                telegramChatId: chats.telegramChatId,
                encryptedToken: bots.encryptedToken,
                botId: bots.id,
                username: bots.username,
                debugEnabled: users.debugEnabled,
            })
            .from(chats)
            .innerJoin(bots, eq(bots.id, chats.botId))
            .innerJoin(users, eq(users.id, bots.userId))
            .where(and(eq(chats.id, chatId), eq(chats.botId, session.botId)))
            .get();
        if (!row) return new NextResponse(null, { status: 404 });

        const { env } = await getCloudflareContext({ async: true });
        const token = await decrypt(row.encryptedToken, env.ENCRYPTION_SECRET);
        const client = new TelegramClient({
            token,
            debug: row.debugEnabled,
            debugLabel: `bot:${row.botId}${row.username ? `:@${row.username}` : ""}`,
        });

        const result = await ensureChatAvatar(row.telegramChatId, {
            r2: env.R2,
            client,
            botId: row.botId,
        });

        if (result.notFound || !result.ok || !result.key) {
            return emptyAvatarResponse();
        }

        let object;
        try {
            object = await env.R2.get(result.key);
        } catch (err) {
            console.error(`[avatar] r2.get failed for chat ${chatId} key ${result.key}:`, err);
            return emptyAvatarResponse();
        }
        if (!object) return emptyAvatarResponse();

        return streamAvatar(object);
    } catch (err) {
        // Any uncaught throw becomes a broken-image glyph in the browser.
        // Log loud and fall back to the transparent PNG so the initials
        // placeholder stays visible.
        console.error("[avatar] unhandled chat avatar route error:", err);
        return emptyAvatarResponse();
    }
}

/** 1x1 transparent PNG served when the target has no photo. */
function emptyAvatarResponse(): Response {
    return new NextResponse(TRANSPARENT_PNG, {
        status: 200,
        headers: {
            "Content-Type": "image/png",
            "Content-Length": String(TRANSPARENT_PNG.byteLength),
            // Cache short-term so the browser doesn't re-hit us for every
            // avatar-less chat on every render, but not too long so a
            // subsequent avatar upload still surfaces within a session.
            "Cache-Control": "public, max-age=300",
        },
    });
}

function streamAvatar(object: R2ObjectBody): Response {
    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType ?? "image/jpeg");
    headers.set("Content-Length", String(object.size));
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
    return new Response(object.body, { status: 200, headers });
}

/**
 * Precomputed 1×1 transparent PNG (67 bytes). Cheaper than shipping a
 * `Uint8Array` builder — same result, no runtime cost.
 */
const TRANSPARENT_PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
]);
