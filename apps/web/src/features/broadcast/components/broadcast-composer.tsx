"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Megaphone, Search, Send, CalendarClock, Users, Paperclip, Image as ImageIcon, File as FileIcon, X } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { ChatRow } from "@telegram-bot/shared/db/schema";
import {
    createBroadcast,
    dispatchBroadcastNow,
} from "@/features/broadcast/actions";
import type { OutboundMessagePayload } from "@telegram-bot/shared/schemas/broadcast";

interface AttachedMedia {
    kind: "photo" | "document";
    r2Key: string;
    mimeType: string;
    filename: string;
    size: number;
}

interface BroadcastComposerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    chats: ChatRow[];
}

/**
 * Fan-out composer: pick many chats, write one message, either dispatch
 * immediately or schedule for later.
 *
 * Wiring:
 *   - Send Now  → createBroadcast() → dispatchBroadcastNow() in one flow.
 *   - Schedule  → createBroadcast(runAt) → cron sweep picks it up when due.
 *
 * Every dispatched target still runs through the shared dispatcher (allowlist
 * + rate limit + encrypted-token + per-outbound ledger), so this composer
 * carries no security bypasses of its own.
 */
export function BroadcastComposer({ open, onOpenChange, chats }: BroadcastComposerProps) {
    const [step, setStep] = useState<"send" | "schedule">("send");
    const [text, setText] = useState("");
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [scheduleAt, setScheduleAt] = useState<string>(defaultLocalDatetime());
    const [busy, setBusy] = useState(false);
    const [attached, setAttached] = useState<AttachedMedia | null>(null);
    const [uploading, setUploading] = useState(false);
    const attachInputRef = useRef<HTMLInputElement>(null);
    const attachIntendedKind = useRef<"photo" | "document">("photo");

    const availableChats = useMemo(() => {
        const q = search.trim().toLowerCase();
        return chats
            .filter((c) => !c.archived)
            .filter((c) => (q ? c.title.toLowerCase().includes(q) : true))
            .sort((a, b) => a.title.localeCompare(b.title));
    }, [chats, search]);

    const reset = () => {
        setStep("send");
        setText("");
        setSearch("");
        setSelected(new Set());
        setScheduleAt(defaultLocalDatetime());
        setBusy(false);
        setAttached(null);
        setUploading(false);
    };

    const openFilePicker = (kind: "photo" | "document") => {
        attachIntendedKind.current = kind;
        const el = attachInputRef.current;
        if (!el) return;
        el.value = "";
        el.accept = kind === "photo" ? "image/*" : "*/*";
        el.click();
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const kind = attachIntendedKind.current;
        setUploading(true);
        const toastId = toast.loading(`Uploading ${file.name}…`);
        try {
            const form = new FormData();
            form.append("file", file);
            form.append("kind", kind);
            const res = await fetch("/api/media/upload", { method: "POST", body: form });
            const json = (await res.json()) as
                | { ok: true; r2Key: string; mimeType: string; size: number; kind: "photo" | "video" | "audio" | "document" }
                | { ok: false; error: string; description?: string };
            if (!json.ok) {
                toast.error(json.description ?? json.error, { id: toastId });
                return;
            }
            setAttached({
                kind,
                r2Key: json.r2Key,
                mimeType: json.mimeType,
                size: json.size,
                filename: file.name,
            });
            toast.success(`${file.name} attached`, { id: toastId });
        } finally {
            setUploading(false);
        }
    };

    const toggle = (id: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => setSelected(new Set(availableChats.map((c) => c.id)));
    const selectNone = () => setSelected(new Set());

    const canSubmit =
        (attached !== null || text.trim().length > 0) &&
        selected.size > 0 &&
        !busy &&
        !uploading;

    const handleSubmit = async () => {
        const targetChatIds = Array.from(selected);
        const caption = text.trim();
        const payload: OutboundMessagePayload = attached
            ? attached.kind === "photo"
                ? { kind: "photo", mediaR2Key: attached.r2Key, caption: caption || undefined }
                : { kind: "document", mediaR2Key: attached.r2Key, caption: caption || undefined }
            : { kind: "text", text: caption };

        setBusy(true);
        try {
            if (step === "send") {
                const created = await createBroadcast({ payload, targetChatIds });
                if (!created.ok) {
                    toast.error(created.error);
                    return;
                }
                const dispatched = await dispatchBroadcastNow(created.broadcastId);
                if (!dispatched.ok) {
                    toast.error(dispatched.error);
                    return;
                }
                const suffix = dispatched.failed > 0 ? `, ${dispatched.failed} failed` : "";
                toast.success(`Sent to ${dispatched.dispatched} chat${dispatched.dispatched === 1 ? "" : "s"}${suffix}`);
                onOpenChange(false);
                reset();
            } else {
                const runAt = Math.floor(new Date(scheduleAt).getTime() / 1000);
                if (!Number.isFinite(runAt) || runAt <= Math.floor(Date.now() / 1000)) {
                    toast.error("Pick a future time.");
                    return;
                }
                const created = await createBroadcast({ payload, targetChatIds, runAt });
                if (!created.ok) {
                    toast.error(created.error);
                    return;
                }
                toast.success(`Scheduled for ${new Date(runAt * 1000).toLocaleString()}`);
                onOpenChange(false);
                reset();
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                onOpenChange(next);
                if (!next) reset();
            }}
        >
            <DialogContent className="sm:max-w-2xl bg-background/95 backdrop-blur-3xl border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <Megaphone className="w-5 h-5 text-primary" />
                        New Broadcast
                    </DialogTitle>
                    <DialogDescription>
                        Compose once, deliver to many. Every target still runs through the allowlist and rate-limit guards.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 min-h-0">
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-muted-foreground">
                            {attached ? "Caption" : "Message"}
                        </span>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            rows={4}
                            placeholder={attached ? "Optional caption..." : "Write your broadcast message..."}
                            className="min-h-24 max-h-64 rounded-[16px] bg-black/5 dark:bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none resize-y focus:bg-background/80 focus:ring-4 focus:ring-primary/20 shadow-[0_2px_10px_rgba(0,0,0,0.02)_inset]"
                            aria-label="Broadcast message text"
                        />
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    disabled={uploading || attached !== null}
                                    className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-accent transition-colors disabled:opacity-40"
                                >
                                    {uploading ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Paperclip className="w-3.5 h-3.5" />
                                    )}
                                    Attach media
                                </DropdownMenuTrigger>
                                <DropdownMenuContent side="top" align="start" sideOffset={4} className="w-40 rounded-[16px] bg-background/95 backdrop-blur-3xl border border-white/10">
                                    <DropdownMenuItem onClick={() => openFilePicker("photo")}>
                                        <ImageIcon className="text-sky-500" /> Photo
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openFilePicker("document")}>
                                        <FileIcon className="text-emerald-500" /> Document
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <span>{text.length} / {attached ? "1024" : "4096"}</span>
                        </div>
                        <input
                            ref={attachInputRef}
                            type="file"
                            className="hidden"
                            onChange={handleFileSelected}
                            aria-hidden="true"
                        />
                        {attached && (
                            <div className="mt-1 flex items-center gap-2 rounded-[12px] bg-black/5 dark:bg-white/5 border border-white/10 px-3 py-2 text-[12px]">
                                {attached.kind === "photo" ? (
                                    <ImageIcon className="w-4 h-4 text-sky-500 shrink-0" />
                                ) : (
                                    <FileIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="truncate font-medium">{attached.filename}</div>
                                    <div className="text-muted-foreground">
                                        {attached.kind} · {formatBytes(attached.size)}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setAttached(null)}
                                    aria-label="Remove attachment"
                                    className="rounded-full p-1 hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </label>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[13px] font-medium text-muted-foreground flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5" /> Targets ({selected.size} selected)
                            </span>
                            <div className="flex items-center gap-2 text-[12px]">
                                <button type="button" onClick={selectAll} className="text-primary hover:underline">Select all</button>
                                <span className="text-muted-foreground">·</span>
                                <button type="button" onClick={selectNone} className="text-muted-foreground hover:underline">Clear</button>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 rounded-[16px] bg-black/5 dark:bg-white/5 px-3 py-2 border border-white/10">
                            <Search className="w-4 h-4 text-muted-foreground/70 shrink-0" />
                            <Input
                                className="h-auto border-0 bg-transparent p-0 shadow-none text-sm placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:border-0"
                                placeholder="Filter chats..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-[16px] border border-white/10 bg-black/5 dark:bg-white/5">
                            {availableChats.length === 0 ? (
                                <div className="p-6 text-center text-sm text-muted-foreground">
                                    {chats.length === 0
                                        ? "No chats yet — messages must be received before you can broadcast to them."
                                        : "No chats match your filter."}
                                </div>
                            ) : (
                                availableChats.map((c) => {
                                    const isSelected = selected.has(c.id);
                                    return (
                                        <label
                                            key={c.id}
                                            className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${isSelected ? "bg-primary/10" : "hover:bg-accent/40"}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggle(c.id)}
                                                className="size-4 accent-primary"
                                            />
                                            <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ${c.avatarColor ?? "bg-slate-500"}`}>
                                                {c.avatarText ?? c.title.slice(0, 2)}
                                            </span>
                                            <span className="flex-1 min-w-0 truncate text-sm font-medium">{c.title}</span>
                                            <Badge variant="secondary" className="h-4 shrink-0 bg-primary/10 text-primary px-1.5 text-[10px] border-transparent capitalize">
                                                {c.type}
                                            </Badge>
                                        </label>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    <Tabs value={step} onValueChange={(v) => setStep(v as "send" | "schedule")} className="w-full">
                        <TabsList className="w-full h-auto rounded-[20px] p-1 bg-black/5 dark:bg-white/5 border border-white/10">
                            <TabsTrigger value="send" className="flex-1 rounded-[16px] py-1.5 text-sm font-medium data-active:bg-background/80 data-active:text-foreground data-active:shadow-sm">
                                <Send className="w-3.5 h-3.5" /> Send Now
                            </TabsTrigger>
                            <TabsTrigger value="schedule" className="flex-1 rounded-[16px] py-1.5 text-sm font-medium data-active:bg-background/80 data-active:text-foreground data-active:shadow-sm">
                                <CalendarClock className="w-3.5 h-3.5" /> Schedule
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="schedule" className="pt-2">
                            <label className="flex flex-col gap-1.5">
                                <span className="text-[13px] font-medium text-muted-foreground">Run at</span>
                                <input
                                    type="datetime-local"
                                    value={scheduleAt}
                                    onChange={(e) => setScheduleAt(e.target.value)}
                                    className="rounded-[16px] bg-black/5 dark:bg-white/5 border border-white/10 px-4 py-2 text-sm outline-none focus:bg-background/80 focus:ring-4 focus:ring-primary/20"
                                />
                                <span className="text-[11px] text-muted-foreground">
                                    Dispatched by the Cron sweep on the next tick after this time.
                                </span>
                            </label>
                        </TabsContent>
                    </Tabs>

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSubmit} disabled={!canSubmit}>
                            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                            {step === "send" ? "Send now" : "Schedule broadcast"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function defaultLocalDatetime(): string {
    const d = new Date(Date.now() + 15 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
