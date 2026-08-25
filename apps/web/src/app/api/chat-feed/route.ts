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
        const { env } = await getCloudflareContext({ async: true });

        const token = request.cookies.get(SESSION_COOKIE)?.value;
        const session = await verifySessionToken(token, env.ENCRYPTION_SECRET);
        if (!session) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        // Detect whether this runtime can actually complete a WebSocket
        // upgrade. Two independent conditions must hold:
        //   1. `env.CHAT_FEED` binding must be defined.
        //   2. `WebSocketPair` global must exist (Cloudflare Workers only).
        //
        // Under `next dev` (Node runtime), miniflare STILL surfaces the
        // CHAT_FEED binding from wrangler.jsonc — but the DO isn't really
        // reachable, and Node can't do a WS upgrade even if it were. Only
        // the `WebSocketPair` check separates workerd from Node dev; the
        // binding check alone is insufficient.
        //
        // Probe protocol: clients do a plain `fetch("/api/chat-feed")`
        // first and read `transport` from the JSON body:
        //   - `"websocket"` → the WS handshake will succeed here.
        //   - `"polling"`   → skip WS entirely and fall back to polling.
        //
        // We return 200 in both cases so the browser devtools don't tint
        // the probe row red. Only a real WS upgrade request path returns
        // a 101 (via the DO) or a 401 (missing session).
        const canUpgrade =
            typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== "undefined";
        const transportAvailable = Boolean(env.CHAT_FEED) && canUpgrade;

        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
            return NextResponse.json({
                transport: transportAvailable ? "websocket" : "polling",
            });
        }

        if (!transportAvailable) {
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
