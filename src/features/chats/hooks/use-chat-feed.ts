"use client";

import { useEffect, useRef } from "react";

/**
 * Subscribes to the /api/chat-feed WebSocket for realtime "chats-updated"
 * signals. Falls back to polling when the socket can't connect (e.g. `next
 * dev` where the ChatFeedHub DO binding isn't provisioned, or an intermittent
 * network / auth failure).
 *
 * The callback is invoked with a debounced trailing edge — many Telegram
 * updates can burst-arrive, and we don't want to trigger N re-fetches when
 * one after the burst is sufficient.
 */
export function useChatFeed(onSignal: () => void, opts?: { pollIntervalMs?: number }) {
    const pollIntervalMs = opts?.pollIntervalMs ?? 15_000;
    const onSignalRef = useRef(onSignal);
    onSignalRef.current = onSignal;

    useEffect(() => {
        // Cap consecutive failed opens before we give up on the WebSocket path
        // for good. `next dev` cannot host the ChatFeedHub DO (Cloudflare's
        // design for in-worker DOs), so the WS endpoint always 501s there —
        // retrying just spams the console. Two attempts is enough to
        // distinguish "transport truly unavailable" from a transient race.
        const MAX_INITIAL_FAILURES = 2;

        let disposed = false;
        let ws: WebSocket | null = null;
        let pollTimer: number | null = null;
        let reconnectTimer: number | null = null;
        let reconnectAttempts = 0;
        let failedOpensInARow = 0;
        let hasEverOpened = false;
        let wsPermanentlyDisabled = false;
        let debounceTimer: number | null = null;

        const clearReconnect = () => {
            if (reconnectTimer !== null) {
                window.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
        };

        const stopPolling = () => {
            if (pollTimer !== null) {
                window.clearInterval(pollTimer);
                pollTimer = null;
            }
        };

        const startPolling = () => {
            if (pollTimer !== null) return;
            pollTimer = window.setInterval(() => {
                if (document.visibilityState === "visible") onSignalRef.current();
            }, pollIntervalMs);
        };

        const fire = () => {
            if (debounceTimer !== null) window.clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(() => {
                debounceTimer = null;
                onSignalRef.current();
            }, 150);
        };

        const connect = () => {
            if (disposed || wsPermanentlyDisabled) return;
            const url = new URL("/api/chat-feed", window.location.href);
            url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
            try {
                ws = new WebSocket(url.toString());
            } catch {
                startPolling();
                return;
            }

            ws.addEventListener("open", () => {
                hasEverOpened = true;
                reconnectAttempts = 0;
                failedOpensInARow = 0;
                stopPolling();
            });

            ws.addEventListener("message", (event) => {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
                } catch {
                    return;
                }
                if (
                    parsed &&
                    typeof parsed === "object" &&
                    (parsed as { type?: unknown }).type === "chats-updated"
                ) {
                    fire();
                }
            });

            ws.addEventListener("close", (event) => {
                ws = null;
                if (disposed) return;

                // 1008 = policy violation (unauth). No point retrying.
                if (event.code === 1008 || event.code === 4401) {
                    wsPermanentlyDisabled = true;
                    startPolling();
                    return;
                }

                // Never opened this session AND we've exhausted the initial
                // attempts — this env doesn't support realtime. Stop trying;
                // polling is the transport from now on.
                if (!hasEverOpened) {
                    failedOpensInARow += 1;
                    if (failedOpensInARow >= MAX_INITIAL_FAILURES) {
                        wsPermanentlyDisabled = true;
                        startPolling();
                        return;
                    }
                }

                startPolling(); // keep data fresh while we reconnect
                reconnectAttempts += 1;
                const delay = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempts, 6));
                clearReconnect();
                reconnectTimer = window.setTimeout(connect, delay);
            });

            ws.addEventListener("error", () => {
                // Error events are always followed by close; let the close handler
                // decide the recovery strategy.
                startPolling();
            });
        };

        const onVisibility = () => {
            if (document.visibilityState !== "visible") return;
            onSignalRef.current();
            if (
                !wsPermanentlyDisabled &&
                (ws === null || ws.readyState === WebSocket.CLOSED)
            ) {
                clearReconnect();
                connect();
            }
        };

        connect();
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            disposed = true;
            document.removeEventListener("visibilitychange", onVisibility);
            clearReconnect();
            stopPolling();
            if (debounceTimer !== null) window.clearTimeout(debounceTimer);
            if (ws) {
                try {
                    ws.close(1000, "unmount");
                } catch {
                    // ignore
                }
                ws = null;
            }
        };
    }, [pollIntervalMs]);
}
