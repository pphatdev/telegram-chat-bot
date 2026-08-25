/**
 * WebSocket-upgrade interceptor for /api/chat-feed.
 *
 * The patch script (scripts/patch-open-next-worker.mjs) compiles this module
 * and injects it at the top of `.open-next/worker.js`, wrapping OpenNext's
 * default fetch handler. The wrapper short-circuits WebSocket upgrades to
 * this endpoint BEFORE Next.js sees them — necessary because Next.js's
 * route pipeline reconstructs Responses and drops the Cloudflare-specific
 * `webSocket` property, breaking the handshake.
 *
 * Zero deps by design: importing anything from src/lib/auth/session.ts would
 * pull in `next/headers`, which we can't run outside a request context. The
 * session-verify + base64url + HMAC helpers are duplicated here on purpose.
 * If you rev the token format in session.ts, mirror the change here.
 */

import type { ChatFeedHub } from "./chat-feed-hub";

const SESSION_COOKIE = "telegram_bot_session";

interface RouterEnv {
    ENCRYPTION_SECRET: string;
    CHAT_FEED?: DurableObjectNamespace<ChatFeedHub>;
}

interface SessionPayload {
    userId: number;
    botId: number;
    exp: number;
}

export async function routeChatFeed(request: Request, env: RouterEnv): Promise<Response> {
    try {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected WebSocket upgrade", { status: 426 });
        }

        const token = readCookie(request.headers.get("cookie") ?? "", SESSION_COOKIE);
        const session = await verifySessionToken(token, env.ENCRYPTION_SECRET);
        if (!session) {
            return new Response("Unauthorized", { status: 401 });
        }

        if (!env.CHAT_FEED) {
            return new Response("Realtime not available in this environment", {
                status: 501,
            });
        }

        const id = env.CHAT_FEED.idFromName(String(session.botId));
        const stub = env.CHAT_FEED.get(id);
        return stub.fetch(request);
    } catch (err) {
        console.error("[chat-feed-router] error:", err);
        return new Response(
            `chat-feed error: ${err instanceof Error ? err.message : String(err)}`,
            { status: 500 },
        );
    }
}

function readCookie(header: string, name: string): string | undefined {
    for (const part of header.split(/;\s*/)) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        if (part.slice(0, eq) === name) return part.slice(eq + 1);
    }
    return undefined;
}

async function verifySessionToken(
    token: string | undefined,
    secret: string,
): Promise<SessionPayload | null> {
    if (!token) return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expectedSig = await mac(body, secret);
    if (!timingSafeEqualStr(sig, expectedSig)) return null;

    let payload: SessionPayload;
    try {
        payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body))) as SessionPayload;
    } catch {
        return null;
    }
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.userId !== "number" || typeof payload.botId !== "number") return null;
    return payload;
}

async function mac(body: string, secretBase64: string): Promise<string> {
    const raw = base64ToBytes(secretBase64);
    const key = await crypto.subtle.importKey(
        "raw",
        raw as BufferSource,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(body) as BufferSource,
    );
    return base64urlEncode(new Uint8Array(sig));
}

function timingSafeEqualStr(a: string, b: string): boolean {
    const enc = new TextEncoder();
    const bufA = enc.encode(a);
    const bufB = enc.encode(b);
    const len = Math.max(bufA.byteLength, bufB.byteLength);
    let mismatch = bufA.byteLength ^ bufB.byteLength;
    for (let i = 0; i < len; i++) mismatch |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
    return mismatch === 0;
}

function base64urlEncode(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Uint8Array {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (s.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
