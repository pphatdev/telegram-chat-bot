"use client";

import {
    AlertTriangle,
    ArrowDownToLine,
    ArrowUpFromLine,
    Bot,
    Pause,
    Play,
    RefreshCw,
    Trash,
    Webhook,
    X,
    Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    deleteBotWebhook,
    loadDebugSnapshot,
    pingBot,
    reregisterBotWebhook,
    type DebugMessagePreview,
    type DebugSnapshot,
} from "@/features/settings/debug-actions";

interface DebugTestPanelProps {
    open: boolean;
    onClose: () => void;
}

const AUTO_REFRESH_INTERVAL_MS = 3_000;

interface FeedRow extends DebugMessagePreview {
    dir: "in" | "out";
}

/**
 * Compact floating debug console mounted from the DebugFab.
 *
 * Purpose: a lightweight log/testing surface the operator can flip open
 * without leaving the chat pane. Distinct from Settings → Debug Logging,
 * which owns the toggle itself and the long-form documentation.
 *
 * Data model:
 *   - `loadDebugSnapshot` returns a coalesced view (bot identity + webhook
 *     info + recent in/out messages). We render it and poll every 3 s
 *     while auto-refresh is on.
 *   - Actions (getMe / re-register / delete webhook) route through the
 *     server actions in `debug-actions.ts`; every one is server-side gated
 *     on `users.debug_enabled`.
 *
 * Layout: bottom-right floating card, above the FAB. Escape or X closes.
 */
export function DebugTestPanel({ open, onClose }: DebugTestPanelProps) {
    const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<null | "reregister" | "delete" | "ping">(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        const result = await loadDebugSnapshot();
        setLoading(false);
        if (result.ok) {
            setSnapshot(result.data);
        } else if (result.code !== "debug_disabled") {
            toast.error(result.error);
        }
    }, []);

    // First-open load + polling loop while auto-refresh is enabled.
    useEffect(() => {
        if (!open) return;
        void refresh();
    }, [open, refresh]);

    useEffect(() => {
        if (!open || !autoRefresh) {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            return;
        }
        timerRef.current = setInterval(() => {
            void refresh();
        }, AUTO_REFRESH_INTERVAL_MS);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [open, autoRefresh, refresh]);

    // Escape closes.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    const handlePing = async () => {
        if (busy) return;
        setBusy("ping");
        const result = await pingBot();
        setBusy(null);
        if (result.ok) {
            toast.success(`getMe OK — id ${result.data.me.id}${result.data.me.username ? ` @${result.data.me.username}` : ""}`);
            void refresh();
        } else {
            toast.error(result.error);
        }
    };

    const handleReregister = async () => {
        if (busy) return;
        setBusy("reregister");
        const result = await reregisterBotWebhook();
        setBusy(null);
        if (result.ok) {
            toast.success("Webhook re-registered");
            void refresh();
        } else {
            toast.error(result.error);
        }
    };

    const handleDelete = async () => {
        if (busy) return;
        if (!confirm("Delete webhook? Telegram will stop delivering updates until you re-register.")) return;
        setBusy("delete");
        const result = await deleteBotWebhook(false);
        setBusy(null);
        if (result.ok) {
            toast.success("Webhook deleted");
            void refresh();
        } else {
            toast.error(result.error);
        }
    };

    /**
     * Interleave inbound + outbound into a single newest-first feed so the
     * operator can follow the round-trip of a single message without
     * switching lists.
     */
    const feed = useMemo<FeedRow[]>(() => {
        if (!snapshot) return [];
        const rows: FeedRow[] = [
            ...snapshot.recentInbound.map((m) => ({ ...m, dir: "in" as const })),
            ...snapshot.recentOutbound.map((m) => ({ ...m, dir: "out" as const })),
        ];
        rows.sort((a, b) => b.sentAt - a.sentAt);
        return rows.slice(0, 20);
    }, [snapshot]);

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-label="Debug console"
            className="fixed top-4 right-4 bottom-4 z-50 w-[min(420px,calc(100vw-2rem))] flex flex-col bg-background/85 backdrop-blur-3xl border border-white/10 rounded-[24px] shadow-[0_20px_60px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] animate-in fade-in slide-in-from-right-6 duration-200 overflow-hidden"
        >
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                    <div className="grid size-7 place-items-center rounded-full bg-amber-500/90 text-white shadow-sm">
                        <Webhook className="w-3.5 h-3.5" />
                    </div>
                    <div>
                        <div className="text-[14px] font-semibold text-foreground leading-tight">Debug Console</div>
                        <div className="text-[11px] text-muted-foreground leading-tight">
                            {snapshot?.bot.username ? `@${snapshot.bot.username}` : "loading…"}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setAutoRefresh((v) => !v)}
                        title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
                        className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-accent/70 hover:text-foreground transition-colors"
                    >
                        {autoRefresh ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={refresh}
                        disabled={loading}
                        title="Refresh now"
                        className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-accent/70 hover:text-foreground transition-colors disabled:opacity-40"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                    <button
                        onClick={onClose}
                        aria-label="Close debug console"
                        className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-accent/70 hover:text-foreground transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* body — scrollable */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 no-scrollbar">
                {!snapshot && loading ? (
                    <div className="py-8 text-center text-[13px] text-muted-foreground">Loading bot status…</div>
                ) : !snapshot ? (
                    <div className="py-8 text-center text-[13px] text-muted-foreground">No snapshot available. Try Refresh.</div>
                ) : (
                    <>
                        {/* PUBLIC_APP_URL misconfiguration callout — shown BEFORE the
                            webhook card so the operator sees the root cause first. */}
                        {(() => {
                            const url = snapshot.publicAppUrl.trim();
                            let parsed: URL | null = null;
                            try {
                                parsed = url ? new URL(url) : null;
                            } catch {
                                parsed = null;
                            }
                            const isMissing = !url;
                            const isHttps = parsed?.protocol === "https:";
                            const isBad = !isMissing && !isHttps;
                            if (!isMissing && isHttps) return null;
                            return (
                                <div className="rounded-[16px] bg-amber-500/10 border border-amber-500/40 p-3 space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                        <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                                            {isMissing ? "PUBLIC_APP_URL is not set" : "PUBLIC_APP_URL must use HTTPS"}
                                        </span>
                                    </div>
                                    {isBad && (
                                        <div className="font-mono text-[11px] text-foreground/85 break-all">{url}</div>
                                    )}
                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                        Telegram rejects non-HTTPS webhooks with{" "}
                                        <code className="bg-accent/40 px-1 rounded font-mono">bad webhook: An HTTPS URL must be provided</code>.
                                        For local dev, tunnel your port and set the tunnel's HTTPS URL:
                                    </p>
                                    <div className="space-y-1">
                                        <div className="text-[11px] text-muted-foreground">Cloudflare Tunnel:</div>
                                        <code className="block text-[10px] font-mono bg-accent/40 rounded px-2 py-1 text-foreground">cloudflared tunnel --url http://localhost:3000</code>
                                        <div className="text-[11px] text-muted-foreground pt-1">ngrok:</div>
                                        <code className="block text-[10px] font-mono bg-accent/40 rounded px-2 py-1 text-foreground">ngrok http 3000</code>
                                        <div className="text-[11px] text-muted-foreground pt-1">Then in <code className="bg-accent/40 px-1 rounded font-mono">.dev.vars</code>:</div>
                                        <code className="block text-[10px] font-mono bg-accent/40 rounded px-2 py-1 text-foreground">PUBLIC_APP_URL=https://your-tunnel.trycloudflare.com</code>
                                        <div className="text-[11px] text-muted-foreground pt-1">Restart <code className="bg-accent/40 px-1 rounded font-mono">next dev</code>, then tap Re-register.</div>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* webhook status */}
                        <div className="rounded-[16px] bg-card/60 border border-white/5 p-3">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                                <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Webhook</div>
                                {snapshot.webhookInfo && (
                                    <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                                        pending {snapshot.webhookInfo.pending_update_count}
                                    </span>
                                )}
                            </div>
                            {snapshot.publicAppUrl && (
                                <div className="mb-2 pb-2 border-b border-border/40">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">PUBLIC_APP_URL</div>
                                    <div className="text-[11px] font-mono text-foreground break-all">{snapshot.publicAppUrl}</div>
                                </div>
                            )}
                            {snapshot.webhookInfoError ? (
                                <div className="text-[12px] bg-red-500/10 border border-red-500/30 rounded-[10px] px-2.5 py-2 space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                        <span className="font-semibold text-red-600 dark:text-red-400">
                                            {snapshot.webhookInfoErrorKind === "network"
                                                ? "Network error — never reached Telegram"
                                                : snapshot.webhookInfoErrorKind === "telegram"
                                                    ? "Telegram rejected the request"
                                                    : "Internal error"}
                                        </span>
                                    </div>
                                    <div className="font-mono text-[11px] text-foreground/85 break-words">
                                        {snapshot.webhookInfoError}
                                    </div>
                                    {snapshot.webhookInfoErrorKind === "network" && (
                                        <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
                                            <li>Check that <code className="font-mono">api.telegram.org</code> is reachable from this machine.</li>
                                            <li>If you're behind a corporate proxy or VPN, try disabling it.</li>
                                            <li>Restart <code className="font-mono">next dev</code> — undici occasionally caches a bad DNS resolution.</li>
                                        </ul>
                                    )}
                                    {snapshot.webhookInfoErrorKind === "telegram" && (
                                        <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
                                            <li><b>401</b>: token revoked or wrong — re-issue via @BotFather.</li>
                                            <li><b>404</b>: token has bad shape.</li>
                                            <li>Try the <b>getMe</b> button above to confirm token validity.</li>
                                        </ul>
                                    )}
                                </div>
                            ) : snapshot.webhookInfo ? (
                                <>
                                    <div className="text-[11px] font-mono text-foreground break-all leading-relaxed">
                                        {snapshot.webhookInfo.url || <em className="text-muted-foreground not-italic">— none registered —</em>}
                                    </div>
                                    {snapshot.webhookInfo.last_error_message && (
                                        <div className="mt-2 flex gap-1.5 bg-red-500/10 border border-red-500/30 rounded-[10px] px-2.5 py-1.5">
                                            <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[11px] font-semibold text-red-600 dark:text-red-400">Telegram last error</div>
                                                <div className="text-[11px] text-foreground/85 break-words">{snapshot.webhookInfo.last_error_message}</div>
                                                {snapshot.webhookInfo.last_error_date && (
                                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                                        {new Date(snapshot.webhookInfo.last_error_date * 1000).toLocaleString()}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-[12px] text-muted-foreground">No webhook data</div>
                            )}
                        </div>

                        {/* action row */}
                        <div className="flex gap-2">
                            <button
                                onClick={handlePing}
                                disabled={!!busy}
                                className="flex-1 flex items-center justify-center gap-1.5 text-[12px] bg-primary/10 text-primary rounded-[12px] px-2 py-2 font-medium hover:bg-primary/20 transition-colors disabled:opacity-40"
                            >
                                <Zap className="w-3.5 h-3.5" />
                                {busy === "ping" ? "…" : "getMe"}
                            </button>
                            <button
                                onClick={handleReregister}
                                disabled={!!busy}
                                className="flex-1 flex items-center justify-center gap-1.5 text-[12px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-[12px] px-2 py-2 font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
                            >
                                <Webhook className="w-3.5 h-3.5" />
                                {busy === "reregister" ? "…" : "Re-register"}
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={!!busy}
                                title="Delete webhook"
                                className="flex items-center justify-center gap-1.5 text-[12px] bg-destructive/10 text-destructive rounded-[12px] px-3 py-2 font-medium hover:bg-destructive/20 transition-colors disabled:opacity-40"
                            >
                                <Trash className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {/* activity feed */}
                        <div className="rounded-[16px] bg-card/60 border border-white/5 overflow-hidden">
                            <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
                                <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Activity</div>
                                <span className={`ml-auto flex items-center gap-1 text-[10px] font-medium ${autoRefresh ? "text-emerald-500" : "text-muted-foreground"}`}>
                                    <span className={`size-1.5 rounded-full ${autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50"}`} />
                                    {autoRefresh ? "live" : "paused"}
                                </span>
                            </div>
                            {feed.length === 0 ? (
                                <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                                    No messages yet. Send the bot a message on Telegram to see it here.
                                </div>
                            ) : (
                                <ul className="divide-y divide-border/40 max-h-[280px] overflow-y-auto no-scrollbar">
                                    {feed.map((m) => (
                                        <li key={`${m.dir}:${m.id}`} className="px-3 py-2 flex gap-2">
                                            <div className="mt-0.5">
                                                {m.dir === "in" ? (
                                                    <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-500" />
                                                ) : (
                                                    <ArrowUpFromLine className={`w-3.5 h-3.5 ${m.status === "failed" ? "text-red-500" : "text-sky-500"}`} />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-[12px] font-medium text-foreground truncate">{m.chatTitle}</div>
                                                    <span className="text-[9px] font-mono bg-accent/50 text-muted-foreground rounded px-1 py-0.5 uppercase">{m.kind}</span>
                                                </div>
                                                <div className={`text-[11px] mt-0.5 truncate ${m.failureReason ? "text-red-500" : "text-muted-foreground"}`}>
                                                    {m.failureReason ?? m.text ?? <em className="not-italic opacity-60">no text</em>}
                                                </div>
                                            </div>
                                            <div className="text-[10px] text-muted-foreground/80 shrink-0 pt-0.5 font-mono">
                                                {new Date(m.sentAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="text-[10px] text-muted-foreground/80 text-center pt-1">
                            Tail the Worker with{" "}
                            <code className="bg-accent/40 rounded px-1 py-0.5 font-mono">wrangler tail | grep tg:debug</code>{" "}
                            for full request/response logs.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
