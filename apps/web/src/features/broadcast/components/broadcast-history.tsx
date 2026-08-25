"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Ban, Check, Clock, Loader2, Megaphone, TriangleAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BroadcastRow } from "@telegram-bot/shared/db/schema";
import { cancelBroadcast, dispatchBroadcastNow } from "@/features/broadcast/actions";

interface BroadcastHistoryProps {
    initial: BroadcastRow[];
}

/**
 * Broadcast history view — a read-mostly ledger with two live actions:
 *   - "Send now" on a `scheduled` row → jumps the queue, runs the sweep
 *     helper immediately (same guardrails as the cron path).
 *   - "Cancel" on a `scheduled` row → soft-cancel via cancelBroadcast.
 *
 * Terminal states (`completed`, `failed`, `cancelled`) are read-only.
 *
 * Optimistic UI: mutations tint the row + swap the status badge before the
 * server round-trip returns; roll back on failure.
 */
export function BroadcastHistory({ initial }: BroadcastHistoryProps) {
    const [rows, setRows] = useState(initial);
    const [pendingId, setPendingId] = useState<number | null>(null);
    const [, startTransition] = useTransition();

    const handleCancel = (id: number) => {
        const snapshot = rows;
        setPendingId(id);
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "cancelled" } : r)));
        startTransition(async () => {
            const result = await cancelBroadcast(id);
            setPendingId(null);
            if (!result.ok) {
                setRows(snapshot);
                toast.error(result.error);
            } else {
                toast.success("Broadcast cancelled");
            }
        });
    };

    const handleDispatchNow = (id: number) => {
        setPendingId(id);
        startTransition(async () => {
            const result = await dispatchBroadcastNow(id);
            setPendingId(null);
            if (!result.ok) {
                toast.error(result.error);
                return;
            }
            setRows((prev) =>
                prev.map((r) =>
                    r.id === id
                        ? {
                            ...r,
                            status: result.status,
                            dispatchedCount: result.dispatched,
                            failedCount: result.failed,
                            completedAt: Math.floor(Date.now() / 1000),
                        }
                        : r,
                ),
            );
            toast.success(`Sent to ${result.dispatched} chat${result.dispatched === 1 ? "" : "s"}${result.failed > 0 ? `, ${result.failed} failed` : ""}`);
        });
    };

    return (
        <main className="min-h-screen w-full flex flex-col items-center bg-background py-10 px-4 sm:px-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-chat-pattern opacity-40 mix-blend-overlay pointer-events-none" />
            <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] pointer-events-none animate-pulse duration-10000" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-teal-500/20 rounded-full blur-[120px] pointer-events-none animate-pulse duration-7000 delay-1000" />

            <div className="relative z-10 w-full max-w-4xl flex flex-col gap-6">
                <header className="flex items-center gap-3">
                    <Link
                        href="/"
                        aria-label="Back to chats"
                        className="grid size-10 place-items-center rounded-full bg-background/60 backdrop-blur-xl border border-white/10 hover:bg-background/80 transition"
                    >
                        <ArrowLeft className="w-4.5 h-4.5" />
                    </Link>
                    <div className="flex items-center gap-2">
                        <Megaphone className="w-6 h-6 text-primary" />
                        <h1 className="text-2xl font-bold tracking-tight">Broadcast History</h1>
                    </div>
                </header>

                {rows.length === 0 ? (
                    <div className="bg-background/40 backdrop-blur-3xl rounded-[24px] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] p-12 text-center">
                        <Megaphone className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                        <p className="text-lg font-semibold mb-1">No broadcasts yet</p>
                        <p className="text-sm text-muted-foreground">Compose one from the sidebar to see it here.</p>
                    </div>
                ) : (
                    <div className="bg-background/40 backdrop-blur-3xl rounded-[24px] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] overflow-hidden">
                        <ul className="divide-y divide-border/50">
                            {rows.map((row) => {
                                const preview = extractPreview(row.payloadJson);
                                const targetCount = countTargets(row.targetsJson);
                                const isPending = pendingId === row.id;
                                return (
                                    <li key={row.id} className="p-5 flex flex-col gap-3 md:flex-row md:items-start md:gap-6">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                <StatusBadge status={row.status} />
                                                <span className="text-[12px] text-muted-foreground">
                                                    {targetCount} target{targetCount === 1 ? "" : "s"}
                                                </span>
                                                <span className="text-[12px] text-muted-foreground">·</span>
                                                <span className="text-[12px] text-muted-foreground">
                                                    Created {formatDateTime(row.createdAt)}
                                                </span>
                                            </div>
                                            <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-3">
                                                {preview || <span className="italic text-muted-foreground">(no text content)</span>}
                                            </p>
                                            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-muted-foreground sm:grid-cols-4">
                                                <MetaRow label="Run at" value={formatDateTime(row.runAt)} />
                                                <MetaRow label="Started" value={row.startedAt ? formatDateTime(row.startedAt) : "—"} />
                                                <MetaRow label="Completed" value={row.completedAt ? formatDateTime(row.completedAt) : "—"} />
                                                <MetaRow
                                                    label="Delivered"
                                                    value={`${row.dispatchedCount} / ${targetCount}${row.failedCount > 0 ? ` (${row.failedCount} failed)` : ""}`}
                                                />
                                            </dl>
                                            {row.lastError && (
                                                <p className="mt-2 text-[12px] text-destructive font-mono truncate">
                                                    Last error: {row.lastError}
                                                </p>
                                            )}
                                        </div>

                                        {row.status === "scheduled" && (
                                            <div className="flex items-center gap-2 md:flex-col md:items-stretch md:min-w-32">
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleDispatchNow(row.id)}
                                                    disabled={isPending}
                                                >
                                                    {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                                    Send now
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    onClick={() => handleCancel(row.id)}
                                                    disabled={isPending}
                                                >
                                                    <Ban className="w-3.5 h-3.5" /> Cancel
                                                </Button>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>
        </main>
    );
}

function MetaRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col">
            <dt className="uppercase tracking-wider text-[10px] font-semibold text-muted-foreground/70">{label}</dt>
            <dd className="text-foreground">{value}</dd>
        </div>
    );
}

function StatusBadge({ status }: { status: BroadcastRow["status"] }) {
    switch (status) {
        case "scheduled":
            return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-transparent"><Clock className="w-3 h-3" /> Scheduled</Badge>;
        case "dispatching":
            return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 border-transparent"><Loader2 className="w-3 h-3 animate-spin" /> Dispatching</Badge>;
        case "completed":
            return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 border-transparent"><Check className="w-3 h-3" /> Completed</Badge>;
        case "failed":
            return <Badge variant="destructive"><TriangleAlert className="w-3 h-3" /> Failed</Badge>;
        case "cancelled":
            return <Badge variant="secondary" className="bg-muted text-muted-foreground border-transparent"><XCircle className="w-3 h-3" /> Cancelled</Badge>;
    }
}

function extractPreview(payloadJson: string): string {
    try {
        const p = JSON.parse(payloadJson) as { kind?: string; text?: string; caption?: string };
        return p.text ?? p.caption ?? "";
    } catch {
        return "";
    }
}

function countTargets(targetsJson: string): number {
    try {
        const arr = JSON.parse(targetsJson) as unknown[];
        return Array.isArray(arr) ? arr.length : 0;
    } catch {
        return 0;
    }
}

function formatDateTime(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
