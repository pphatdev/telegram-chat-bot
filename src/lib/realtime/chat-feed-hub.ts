import { DurableObject } from "cloudflare:workers";

/**
 * ChatFeedHub — per-bot realtime notification bus.
 *
 * One DO instance per botId (routed via env.CHAT_FEED.idFromName(String(botId))).
 * Browsers open a WebSocket; the webhook route pings broadcast() after every
 * persisted Telegram update. The DO fans out a tiny `chats-updated` signal —
 * no data, no chat rows, no message bodies. Clients re-fetch via the existing
 * session-guarded server actions, so the auth boundary is unchanged and one
 * bot can never see another bot's data through this channel.
 *
 * WebSockets use Cloudflare's hibernation API (state.acceptWebSocket), so
 * idle connections don't hold a live isolate — DO wakes only on message,
 * close, or an incoming broadcast() call.
 */

export type ChatFeedEvent = { type: "chats-updated"; at: number };

export class ChatFeedHub extends DurableObject {
    async fetch(request: Request): Promise<Response> {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket upgrade", { status: 426 });
        }
        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        this.ctx.acceptWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
    }

    async broadcast(): Promise<void> {
        const event: ChatFeedEvent = { type: "chats-updated", at: Date.now() };
        const payload = JSON.stringify(event);
        for (const ws of this.ctx.getWebSockets()) {
            try {
                ws.send(payload);
            } catch {
                // Socket died between getWebSockets() and send(); the close
                // handler will clean up. Ignore.
            }
        }
    }

    // Hibernation-mode handlers. Empty bodies are fine — we only care about
    // server → client pushes. If a client sends anything we silently drop it.
    webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {}

    webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
        try {
            ws.close(code, "closed");
        } catch {
            // Already closed.
        }
    }

    webSocketError(ws: WebSocket, _error: unknown): void {
        try {
            ws.close(1011, "internal error");
        } catch {
            // Already closed.
        }
    }
}
