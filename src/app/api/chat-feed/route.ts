import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * GET /api/chat-feed  (WebSocket upgrade)
 *
 * Realtime channel that the chat sidebar subscribes to. Verifies the session
 * HMAC + resolves the caller's botId, then forwards the upgrade to that
 * bot's ChatFeedHub Durable Object. The DO owns the connection (hibernating
 * WS) and pushes tiny `chats-updated` signals whenever the webhook broadcasts.
 *
 * Auth: session cookie is HMAC-verified BEFORE any DO plumbing runs. DO id
 * comes from `idFromName(String(botId))`, giving one tenant per bot.
 *
 * The route is intentionally NOT `runtime = "edge"` — OpenNext's edge
 * converter reconstructs Responses and drops the Cloudflare-specific
 * `webSocket` property. The default (Node-emulated) runtime passes through
 * to the underlying Worker fetch handler, preserving the upgrade.
 */
export async function GET(request: NextRequest) {
    try {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
            return new NextResponse("Expected WebSocket upgrade", { status: 426 });
        }

        const { env } = await getCloudflareContext({ async: true });

        const token = request.cookies.get(SESSION_COOKIE)?.value;
        const session = await verifySessionToken(token, env.ENCRYPTION_SECRET);
        if (!session) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        if (!env.CHAT_FEED) {
            return new NextResponse("Realtime not available in this environment", {
                status: 501,
            });
        }

        const id = env.CHAT_FEED.idFromName(String(session.botId));
        const stub = env.CHAT_FEED.get(id);
        return stub.fetch(request);
    } catch (err) {
        console.error("[chat-feed] upgrade failed:", err);
        return new NextResponse(
            `chat-feed error: ${err instanceof Error ? err.message : String(err)}`,
            { status: 500 },
        );
    }
}
