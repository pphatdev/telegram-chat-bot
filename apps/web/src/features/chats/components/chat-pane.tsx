"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ChatHeader } from "@/features/chats/components/chat-header";
import { ChatMessage, type ReplyTarget } from "@/features/chats/components/chat-message";
import { ChatInput } from "@/features/chats/components/chat-input";
import { ChatProfile } from "@/features/chats/components/chat-profile";
import { loadMessages, reactToMessage } from "@/features/chats/actions";
import { applyBotReaction, parseReactionsJson, serializeReactions } from "@/features/chats/reactions";
import { useChatFeed } from "@/features/chats/hooks/use-chat-feed";
import {
    applyChatBackground,
    DEFAULT_CHAT_BG,
    loadChatBackground,
    loadChatBackgroundFor,
    saveChatBackgroundFor,
    type ChatBackground,
} from "@/features/settings/lib/chat-background";

import type { ChatRow, MessageRow } from "@telegram-bot/shared/db/schema";

/**
 * Messages loaded per pagination page. Balances D1 read cost against UX
 * smoothness — 50 fits ~1.5 screens of standard-density messages, so the
 * user typically scrolls one screen before triggering the next fetch.
 */
const MESSAGE_PAGE_SIZE = 50;
/** How close to the top before we auto-fetch the next older page (px). */
const LOAD_OLDER_THRESHOLD_PX = 120;
/** How close to the bottom counts as "at the bottom" for auto-scroll (px). */
const AT_BOTTOM_THRESHOLD_PX = 48;

/** Kept in sync with the constant in `chat-frame.tsx`. */
const CHAT_BG_CHANGED_EVENT = "chat-bg-changed";

interface ChatPaneProps {
    chat: ChatRow;
    /** Server-fetched first page (chronological, oldest→newest). */
    initialMessages: MessageRow[];
    /** True when the initial page was full — pagination up is available. */
    initialCanLoadMore: boolean;
}

/**
 * Per-conversation interactive pane. Rendered at `/chat/[chatId]`.
 *
 * Owns every piece of state that's specific to a single thread: messages,
 * reply target, search box, emoji tab, scroll position, pagination cursor,
 * pending-new-message counter, profile panel visibility.
 *
 * Because Next remounts this component on route change (each `[chatId]` is
 * a fresh render), we don't need to track "which chat did I last render
 * for?" — `chat.id` is stable for the component's lifetime. That
 * eliminates the previous shell's `activeChatIdRef` / `didInitialScrollForChatRef`
 * bookkeeping.
 */
export function ChatPane({ chat, initialMessages, initialCanLoadMore }: ChatPaneProps) {
    const router = useRouter();

    const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
    const [showProfile, setShowProfile] = useState(false);
    const [innerSearchQuery, setInnerSearchQuery] = useState("");
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
    const [activeEmojiTab, setActiveEmojiTab] = useState<"emoji" | "sticker" | "gif">("emoji");
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Pagination state — initialCanLoadMore reflects the server's first-page
    // page size vs. what came back. When the server returned fewer than a
    // full page, we know there's no older history to fetch.
    const [hasMoreOlder, setHasMoreOlder] = useState(initialCanLoadMore);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [pendingNewCount, setPendingNewCount] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const isAtBottomRef = useRef(true);
    isAtBottomRef.current = isAtBottom;

    /**
     * Background state read from localStorage. Passed to <ChatProfile> for
     * the color/preset/URL editor. When the user changes the override we
     * both persist AND dispatch a `chat-bg-changed` event so <ChatFrame>
     * (which paints via CSS custom properties on documentElement) repaints
     * without having to prop-drill through the RSC boundary.
     */
    const [chatBgOverride, setChatBgOverride] = useState<ChatBackground | null>(null);
    const [globalBg, setGlobalBg] = useState<ChatBackground>(DEFAULT_CHAT_BG);

    useEffect(() => {
        setChatBgOverride(loadChatBackgroundFor(chat.id));
        setGlobalBg(loadChatBackground());
    }, [chat.id]);

    const handleActiveChatBgChange = useCallback(
        (next: ChatBackground | null) => {
            saveChatBackgroundFor(chat.id, next);
            setChatBgOverride(next);
            // Notify the frame so it can repaint the CSS custom properties.
            // Also immediately re-apply locally so the current pane sees the
            // change even if the event bounce hasn't landed yet.
            applyChatBackground(next ?? globalBg);
            window.dispatchEvent(
                new CustomEvent(CHAT_BG_CHANGED_EVENT, {
                    detail: { chatId: chat.id, bg: next },
                }),
            );
        },
        [chat.id, globalBg],
    );

    const handleReply = useCallback((target: ReplyTarget) => {
        setReplyTo(target);
        setTimeout(() => inputRef.current?.focus(), 0);
    }, []);

    /**
     * Snap the message list to the newest message. Called on initial mount,
     * after the user's own send, and when the user taps the floating
     * scroll-to-latest button.
     */
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior });
        setPendingNewCount(0);
    }, []);

    /**
     * On mount, pin the scroll position to the newest message. `useLayoutEffect`
     * fires synchronously post-DOM so the user never sees the list flash from
     * the top. Fires once because this component remounts per-chat route.
     */
    useLayoutEffect(() => {
        if (messages.length === 0) return;
        scrollToBottom("auto");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * Fetch the previous page using the oldest currently-loaded message's
     * `sentAt` as the cursor. Preserves scroll position: measure the scroll
     * distance from the bottom before the prepend, then restore it after
     * the DOM has grown. If the new page is empty or short, mark
     * `hasMoreOlder=false` so we stop asking.
     */
    const loadOlder = useCallback(async () => {
        if (loadingOlder || !hasMoreOlder) return;
        const oldest = messages[0];
        if (!oldest) return;

        setLoadingOlder(true);
        const el = scrollRef.current;
        const prevScrollHeight = el?.scrollHeight ?? 0;
        const prevScrollTop = el?.scrollTop ?? 0;

        const result = await loadMessages(chat.id, {
            limit: MESSAGE_PAGE_SIZE,
            cursorSentAt: oldest.sentAt,
        });
        setLoadingOlder(false);

        if (!result.ok) {
            toast.error(result.error);
            return;
        }
        if (result.data.length === 0) {
            setHasMoreOlder(false);
            return;
        }

        setMessages((prev) => {
            const existing = new Set(prev.map((m) => m.id));
            const merged = [...result.data.filter((m) => !existing.has(m.id)), ...prev];
            return merged;
        });
        if (result.data.length < MESSAGE_PAGE_SIZE) setHasMoreOlder(false);

        // Restore scroll position after the DOM updates. Without this the
        // viewport snaps to the top on every prepend and the reader loses
        // their place mid-thread.
        requestAnimationFrame(() => {
            const el2 = scrollRef.current;
            if (!el2) return;
            const heightDelta = el2.scrollHeight - prevScrollHeight;
            el2.scrollTop = prevScrollTop + heightDelta;
        });
    }, [chat.id, messages, loadingOlder, hasMoreOlder]);

    /**
     * Scroll handler: detects the user's position for (a) auto-loading
     * older pages when near the top, (b) toggling the floating jump-to-
     * bottom button, and (c) clearing the pending-new-messages counter
     * when the user catches up to the tail.
     */
    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const atBottom = distanceFromBottom < AT_BOTTOM_THRESHOLD_PX;
        setIsAtBottom(atBottom);
        if (atBottom) setPendingNewCount(0);

        if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && hasMoreOlder && !loadingOlder && messages.length > 0) {
            void loadOlder();
        }
    }, [hasMoreOlder, loadingOlder, messages.length, loadOlder]);

    // Esc → close profile if open, else back to sidebar/root.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (showProfile) {
                    setShowProfile(false);
                } else {
                    router.push("/");
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [router, showProfile]);

    // Auto-hide the profile panel when the viewport gets too narrow to
    // fit sidebar + chat + profile simultaneously. Matches the previous
    // ChatShell behavior — we don't have the exact sidebar width here so
    // approximate with the common resizable range's midpoint (330 px).
    useEffect(() => {
        if (!showProfile) return;
        const checkWidth = () => {
            if (window.innerWidth >= 1024 && window.innerWidth < 330 + 725) {
                setShowProfile(false);
            }
        };
        checkWidth();
        window.addEventListener("resize", checkWidth);
        return () => window.removeEventListener("resize", checkWidth);
    }, [showProfile]);

    /**
     * Realtime refresh via ChatFeedHub DO WebSocket. On every "chats-updated"
     * signal we re-pull the latest page for THIS chat and merge into state
     * so any older messages the reader paginated in stay visible.
     */
    const refreshFromSignal = useCallback(async () => {
        const msgResult = await loadMessages(chat.id, { limit: MESSAGE_PAGE_SIZE });
        if (!msgResult.ok) return;

        let newlyArrivedInbound = 0;
        setMessages((prev) => {
            const existing = new Set(prev.map((m) => m.id));
            const additions = msgResult.data.filter((m) => !existing.has(m.id));
            if (additions.length === 0) return prev;
            newlyArrivedInbound = additions.filter((m) => m.direction === "in").length;
            // Insert into chronological order — sentAt is the sort key everywhere.
            return [...prev, ...additions].sort((a, b) => a.sentAt - b.sentAt);
        });

        // Auto-scroll only if the reader was already at the tail; otherwise
        // surface the new-messages counter so they can jump down on demand.
        if (isAtBottomRef.current) {
            requestAnimationFrame(() => scrollToBottom("smooth"));
        } else if (newlyArrivedInbound > 0) {
            setPendingNewCount((prev) => prev + newlyArrivedInbound);
        }
    }, [chat.id, scrollToBottom]);

    useChatFeed(refreshFromSignal);

    const filteredMessages = useMemo(() => {
        const q = innerSearchQuery.trim().toLowerCase();
        if (!q) return messages;
        return messages.filter((m) => (m.text ?? "").toLowerCase().includes(q));
    }, [messages, innerSearchQuery]);

    /**
     * Build a `telegram_message_id → MessageRow` index so we can render a
     * reply-preview chip on any message whose parent is inside the currently-
     * loaded window. Messages whose parent has fallen off the top (or was
     * never fetched) render as a reply without a chip — cheaper than fetching
     * the parent lazily and matches Telegram's own behavior when the parent
     * is out of view.
     */
    const messagesByTelegramId = useMemo(() => {
        const map = new Map<number, MessageRow>();
        for (const m of messages) {
            if (typeof m.telegramMessageId === "number") map.set(m.telegramMessageId, m);
        }
        return map;
    }, [messages]);

    /**
     * Scroll a target message into view and briefly highlight it so the
     * reader can visually confirm where it landed. Uses the `data-tg-msg-id`
     * attribute we stamp on each message wrapper. Falls back silently if the
     * target isn't in the currently-loaded window (e.g. parent scrolled off
     * before the reader paginated back to it).
     */
    const handleJumpToMessage = useCallback((telegramMessageId: number) => {
        const container = scrollRef.current;
        if (!container) return;
        const el = container.querySelector<HTMLElement>(
            `[data-tg-msg-id="${telegramMessageId}"]`,
        );
        if (!el) {
            toast("Message is out of view — scroll up to load older history.");
            return;
        }
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash: temporarily tint the wrapper. Two frames to let the browser
        // paint the initial (default) state before the transition kicks in.
        el.classList.add("bg-primary/15");
        setTimeout(() => el.classList.remove("bg-primary/15"), 900);
    }, []);

    /**
     * Append an outbound message row. Called both for the optimistic append
     * (right after Send — row carries `status: 'sending'` and a negative
     * client-generated id) AND for the final append on the file path.
     * Whatever id is on the row is what lands in state.
     */
    const handleMessageSent = useCallback((row: MessageRow) => {
        setMessages((prev) => [...prev, row]);
        setReplyTo(null);
        // Sender always wants to see what they just sent — jump to bottom
        // regardless of where they were scrolled.
        requestAnimationFrame(() => scrollToBottom("smooth"));
    }, [scrollToBottom]);

    /**
     * Reconcile (or fail) an optimistic outbound row. `clientId` is the
     * negative id chat-input used when it appended optimistically; `patch`
     * either carries the real server row fields (success) or a
     * `{status: 'failed', failureReason}` marker (error).
     */
    const handleMessageReconcile = useCallback(
        (clientId: number, patch: Partial<MessageRow>) => {
            setMessages((prev) =>
                prev.map((m) => (m.id === clientId ? { ...m, ...patch } : m)),
            );
        },
        [],
    );

    /**
     * Set / clear the bot's reaction to a message.
     *
     * **Coalescing model.** Reactions are a spammable toggle — the user
     * flicks through 👍→❤️→😂 faster than a round-trip. Firing every
     * click would queue N sequential requests, hit Telegram's per-message
     * reaction rate limit, and make the bubble flicker as each response
     * reconciles. Instead we run at most one in-flight request per message
     * and coalesce intermediate clicks:
     *
     *   1. Optimistic UI updates immediately on every click (snappy).
     *   2. Per-message runner drains a "latest intent" ref in a loop —
     *      after each response, if the intent changed while we awaited,
     *      the next iteration sends the new one; otherwise it reconciles
     *      with server truth and exits.
     *   3. Rollback on error reverts to the *pre-burst* baseline (captured
     *      on the first click of a burst, not on each intermediate click).
     *
     * `nextEmoji === null` removes the bot's current reaction (same server
     * path as setting a new one; Telegram treats an empty `reaction` array
     * as a clear).
     */
    const reactionRunnersRef = useRef<Map<number, { baseline: string | null; latest: string | null; running: boolean }>>(
        new Map(),
    );

    const drainReactionQueue = useCallback(async (dbMessageId: number) => {
        const state = reactionRunnersRef.current.get(dbMessageId);
        if (!state || state.running) return;
        state.running = true;

        try {
            let lastSent: string | null | undefined;
            while (state.latest !== lastSent) {
                const intent = state.latest;
                lastSent = intent;
                const result = await reactToMessage(dbMessageId, intent);
                if (!result.ok) {
                    const baseline = state.baseline;
                    setMessages((prev) =>
                        prev.map((m) => (m.id === dbMessageId ? { ...m, reactionsJson: baseline } : m)),
                    );
                    toast.error(result.error);
                    return;
                }
                // Only reconcile if the user hasn't clicked again since —
                // the response would otherwise flicker over the newer
                // optimistic state we already showed them.
                if (state.latest === intent) {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === dbMessageId
                                ? { ...m, reactionsJson: serializeReactions(result.data.reactions) }
                                : m,
                        ),
                    );
                }
            }
        } finally {
            state.running = false;
            reactionRunnersRef.current.delete(dbMessageId);
        }
    }, []);

    const handleReact = useCallback(
        (dbMessageId: number, nextEmoji: string | null) => {
            // Optimistic write + baseline capture in the same setMessages
            // pass so we always see the true pre-burst reactionsJson.
            setMessages((prev) =>
                prev.map((m) => {
                    if (m.id !== dbMessageId) return m;
                    const existing = reactionRunnersRef.current.get(dbMessageId);
                    if (existing) {
                        existing.latest = nextEmoji;
                    } else {
                        reactionRunnersRef.current.set(dbMessageId, {
                            baseline: m.reactionsJson,
                            latest: nextEmoji,
                            running: false,
                        });
                    }
                    const before = parseReactionsJson(m.reactionsJson);
                    const after = applyBotReaction(before, nextEmoji);
                    return { ...m, reactionsJson: serializeReactions(after) };
                }),
            );
            void drainReactionQueue(dbMessageId);
        },
        [drainReactionQueue],
    );

    return (
        <>
            <section
                className={`bg-background/40 backdrop-blur-3xl rounded-[32px] shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] min-w-93.75 flex-1 flex-col overflow-hidden relative ${showProfile ? "hidden lg:flex" : "flex animate-in fade-in slide-in-from-right-8 lg:animate-none duration-300"}`}
            >
                {/* User-selected conversation background (color or image). Driven
                    by CSS custom properties set on documentElement by
                    applyChatBackground() so it re-styles without a React render.
                    Negative z-index keeps the layer under the header/messages/
                    input (which are position: static and paint at their own
                    stacking level) while still sitting above the section's own
                    translucent bg — giving the glass-over-tint look. */}
                <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none -z-10"
                    style={{
                        backgroundColor: "var(--chat-bg-color, transparent)",
                        backgroundImage: "var(--chat-bg-image, none)",
                        backgroundSize: "var(--chat-bg-size, cover)",
                        backgroundPosition: "center",
                        backgroundRepeat: "var(--chat-bg-repeat, no-repeat)",
                    }}
                />
                <ChatHeader
                    title={chat.title}
                    avatarText={chat.avatarText ?? chat.title.slice(0, 2)}
                    avatarColor={chat.avatarColor ?? "bg-sky-500"}
                    chatId={chat.id}
                    subtitle={chat.type === "private" ? "Private chat" : `${chat.type} conversation`}
                    closeChat={() => {
                        setIsSearchOpen(false);
                        setInnerSearchQuery("");
                        router.push("/");
                    }}
                    onProfileClick={() => setShowProfile(!showProfile)}
                    innerSearchQuery={innerSearchQuery}
                    setInnerSearchQuery={setInnerSearchQuery}
                    isSearchOpen={isSearchOpen}
                    setIsSearchOpen={setIsSearchOpen}
                />

                <div className="mx-auto flex w-full max-w-4xl min-w-93.75 flex-1 flex-col overflow-hidden px-3 sm:px-8 relative">
                    <div
                        ref={scrollRef}
                        onScroll={handleScroll}
                        className="flex-1 overflow-y-auto py-6"
                    >
                        {filteredMessages.length === 0 ? (
                            <div className="text-center py-10 text-sm text-muted-foreground">
                                {innerSearchQuery ? "No matches in this thread." : "No messages yet."}
                            </div>
                        ) : (
                            <>
                                {/* Top-of-list indicator: spinner while fetching older,
                                    quiet marker once history is exhausted, otherwise
                                    nothing (scroll-to-top auto-triggers loadOlder). */}
                                {loadingOlder ? (
                                    <div className="flex justify-center py-3 text-xs text-muted-foreground">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    </div>
                                ) : !hasMoreOlder && !innerSearchQuery && messages.length > 0 ? (
                                    <div className="text-center py-3 text-[11px] uppercase tracking-wider text-muted-foreground/60">
                                        Beginning of conversation
                                    </div>
                                ) : null}
                                {filteredMessages.map((msg) => {
                                    const parent = msg.replyToMessageId
                                        ? messagesByTelegramId.get(msg.replyToMessageId)
                                        : undefined;
                                    const replyPreview = parent && typeof parent.telegramMessageId === "number"
                                        ? {
                                            author: parent.direction === "out"
                                                ? "You"
                                                : parent.authorName ?? "User",
                                            text: parent.text ?? previewForKind(parent.kind),
                                            telegramMessageId: parent.telegramMessageId,
                                        }
                                        : null;
                                    return (
                                        <ChatMessage
                                            key={msg.id}
                                            author={msg.direction === "in" ? msg.authorName ?? undefined : undefined}
                                            authorInitials={msg.direction === "in" ? initials(msg.authorName ?? "") : undefined}
                                            authorColorClass="bg-sky-500"
                                            text={msg.text ?? ""}
                                            time={formatTime(msg.sentAt)}
                                            align={msg.direction === "out" ? "end" : "start"}
                                            isOwnMessage={msg.direction === "out"}
                                            telegramMessageId={msg.telegramMessageId}
                                            authorTelegramId={msg.direction === "in" ? msg.authorTelegramId : null}
                                            reactions={parseReactionsJson(msg.reactionsJson)}
                                            onReply={handleReply}
                                            onReact={(next) => handleReact(msg.id, next)}
                                            status={msg.status}
                                            failureReason={msg.failureReason}
                                            kind={msg.kind}
                                            mediaUrl={msg.mediaR2Key}
                                            mediaMimeType={msg.mediaMimeType}
                                            replyPreview={replyPreview}
                                            onJumpToMessage={handleJumpToMessage}
                                        />
                                    );
                                })}
                            </>
                        )}
                    </div>

                    {/* Jump-to-latest FAB — appears whenever the reader isn't
                        already pinned to the tail. If new inbound messages
                        arrived while scrolled up, the count sits in a badge on
                        the FAB so the reader knows how many are waiting. */}
                    {!isAtBottom && messages.length > 0 && (
                        <button
                            type="button"
                            onClick={() => scrollToBottom("smooth")}
                            aria-label={pendingNewCount > 0 ? `Scroll to ${pendingNewCount} new message${pendingNewCount === 1 ? "" : "s"}` : "Scroll to latest message"}
                            className="absolute bottom-24 right-4 sm:right-10 z-30 grid size-10 place-items-center rounded-full bg-background/85 backdrop-blur-xl border border-white/10 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] hover:bg-background transition-colors active:scale-95 animate-in fade-in slide-in-from-bottom-2 duration-200"
                        >
                            <ChevronDown className="w-5 h-5" />
                            {pendingNewCount > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold grid place-items-center border border-background shadow-sm">
                                    {pendingNewCount > 99 ? "99+" : pendingNewCount}
                                </span>
                            )}
                        </button>
                    )}

                    <ChatInput
                        activeChatId={chat.id}
                        replyTo={replyTo}
                        setReplyTo={setReplyTo}
                        inputRef={inputRef}
                        activeEmojiTab={activeEmojiTab}
                        setActiveEmojiTab={setActiveEmojiTab}
                        onMessageSent={handleMessageSent}
                        onMessageReconcile={handleMessageReconcile}
                    />
                </div>
            </section>

            {showProfile && (
                <div
                    className={
                        "absolute inset-0 z-50 flex md:items-center md:justify-center md:bg-black/20 md:backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none lg:static lg:block lg:w-auto lg:h-auto"
                    }
                >
                    <ChatProfile
                        chat={chat}
                        onClose={() => setShowProfile(false)}
                        chatBgOverride={chatBgOverride}
                        globalBg={globalBg}
                        onChatBgChange={handleActiveChatBgChange}
                        onChatDeleted={() => {
                            router.push("/");
                        }}
                    />
                </div>
            )}
        </>
    );
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "??";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(unixSeconds: number): string {
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Fallback preview text for a reply chip when the parent message has no
 * body (media-only). Kept intentionally terse — the chip is a one-liner.
 */
function previewForKind(kind: MessageRow["kind"]): string {
    switch (kind) {
        case "photo": return "📷 Photo";
        case "video": return "🎬 Video";
        case "audio": return "🎵 Audio";
        case "sticker": return "🎴 Sticker";
        case "document": return "📎 Document";
        case "location": return "📍 Location";
        case "contact": return "👤 Contact";
        default: return "Message";
    }
}
