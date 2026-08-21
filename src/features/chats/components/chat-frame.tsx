"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChatSidebar } from "@/features/chats/components/chat-sidebar";
import { PasscodeLock } from "@/features/auth/components/passcode-lock";
import { refreshChats } from "@/features/chats/actions";
import { useChatFeed } from "@/features/chats/hooks/use-chat-feed";
import {
    applyChatBackground,
    DEFAULT_CHAT_BG,
    loadChatBackground,
    loadChatBackgroundFor,
    saveChatBackground,
    type ChatBackground,
} from "@/features/settings/lib/chat-background";

import type { ChatRow } from "@/db/schema";

interface ChatFrameProps {
    initialChats: ChatRow[];
    children: React.ReactNode;
}

/**
 * Custom event dispatched from `<ChatPane>` when the user changes the
 * per-conversation background from the profile panel. ChatFrame listens so
 * it can re-resolve which background layer paints (per-chat override wins
 * over the global default). Namespaced constant so we don't accidentally
 * collide with browser-native event names.
 */
const CHAT_BG_CHANGED_EVENT = "chat-bg-changed";

interface ChatBgChangedDetail {
    chatId: number;
    /** `null` clears the override so the chat inherits the global default. */
    bg: ChatBackground | null;
}

/**
 * Client shell that wraps every route in the `(chats)` group.
 *
 * Owns everything that must survive route transitions between `/` and
 * `/chat/[chatId]`:
 *   - The sidebar's `chats` state + resizer width
 *   - The passcode-lock toggle + Ctrl/Cmd+L global shortcut
 *   - The chat-background layer (global default + per-chat override paint)
 *   - The realtime `useChatFeed` subscription for sidebar freshness
 *
 * Per-chat interactive state (messages, replies, scroll, search) lives in
 * `<ChatPane>` where it belongs — that component remounts on route change,
 * so its state naturally resets per-chat.
 *
 * The active chat id is derived from `usePathname()` rather than local
 * state, so navigation is the source of truth. This lets prefetch,
 * back/forward, and deep-linking all Just Work.
 */
export function ChatFrame({ initialChats, children }: ChatFrameProps) {
    const pathname = usePathname();
    const activeChatId = parseActiveChatId(pathname);

    const [chats, setChats] = useState<ChatRow[]>(initialChats);
    const [sidebarWidth, setSidebarWidth] = useState(330);
    const [isLocked, setIsLocked] = useState(false);

    /**
     * Chat background — split into a global default (Settings › Appearance)
     * and an optional per-chat override (Chat profile › Background). The
     * override wins when present; otherwise the active chat inherits the
     * global. Both live in `localStorage`; CSS custom properties on
     * `documentElement` drive the actual paint via `applyChatBackground`.
     */
    const [globalBg, setGlobalBg] = useState<ChatBackground>(DEFAULT_CHAT_BG);
    /** `null` = active chat has no override, or no chat is active. */
    const [activeChatBgOverride, setActiveChatBgOverride] = useState<ChatBackground | null>(null);

    // Rehydrate the persisted global default once on mount and paint it —
    // deferred out of the useState initializer so SSR doesn't touch storage.
    useEffect(() => {
        const stored = loadChatBackground();
        setGlobalBg(stored);
        applyChatBackground(stored);
    }, []);

    // Re-resolve the paint whenever the active chat (URL segment) or the
    // global default changes. The per-chat override wins; otherwise the
    // global paints. When no chat is active, the global always wins.
    useEffect(() => {
        if (activeChatId === null) {
            setActiveChatBgOverride(null);
            applyChatBackground(globalBg);
            return;
        }
        const override = loadChatBackgroundFor(activeChatId);
        setActiveChatBgOverride(override);
        applyChatBackground(override ?? globalBg);
    }, [activeChatId, globalBg]);

    // ChatPane fires this when the user picks a new per-conversation
    // background from the profile panel. We listen here (rather than the
    // pane re-resolving itself) because the paint targets `documentElement`,
    // which is owned by the frame — this keeps the sidebar's own tinting
    // consistent when the user backs out to `/`.
    useEffect(() => {
        const onBgChanged = (event: Event) => {
            const detail = (event as CustomEvent<ChatBgChangedDetail>).detail;
            if (!detail) return;
            if (detail.chatId !== activeChatId) return;
            setActiveChatBgOverride(detail.bg);
            applyChatBackground(detail.bg ?? globalBg);
        };
        window.addEventListener(CHAT_BG_CHANGED_EVENT, onBgChanged);
        return () => window.removeEventListener(CHAT_BG_CHANGED_EVENT, onBgChanged);
    }, [activeChatId, globalBg]);

    const handleGlobalBgChange = useCallback((next: ChatBackground) => {
        setGlobalBg(next);
        saveChatBackground(next);
        // The active-chat effect above will repaint when `globalBg` changes.
    }, []);

    // Ctrl/Cmd+L → invoke the passcode lock overlay from anywhere.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "l") {
                e.preventDefault();
                setIsLocked(true);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    /**
     * Realtime refresh via ChatFeedHub DO WebSocket. On every "chats-updated"
     * signal we re-pull the sidebar list and merge it into local state,
     * preserving any transient optimistic toggles (pinned/muted/archived)
     * the user just performed. ChatPane runs its own `useChatFeed` for the
     * currently-open thread.
     */
    const refreshFromSignal = useCallback(async () => {
        const chatsResult = await refreshChats();
        if (chatsResult.ok) {
            setChats((prev) => mergeChats(prev, chatsResult.data));
        }
    }, []);

    useChatFeed(refreshFromSignal);

    return (
        <main className="flex h-screen bg-background lg:p-2 relative overflow-hidden">
            <div className="absolute inset-0 bg-chat-pattern opacity-40 mix-blend-overlay pointer-events-none" />
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 rounded-full blur-[120px] pointer-events-none animate-pulse duration-10000" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-teal-500/20 rounded-full blur-[120px] pointer-events-none animate-pulse duration-7000 delay-1000" />
            <div className="absolute top-[30%] left-[40%] w-[30%] h-[30%] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none animate-pulse duration-5000" />

            <div className="relative z-10 flex h-full w-full gap-2">
                {isLocked && <PasscodeLock onUnlock={() => setIsLocked(false)} correctPasscode="1234" />}

                <ChatSidebar
                    chats={chats}
                    setChats={setChats}
                    sidebarWidth={sidebarWidth}
                    setSidebarWidth={setSidebarWidth}
                    globalBg={globalBg}
                    onGlobalBgChange={handleGlobalBgChange}
                />

                {/* Pane slot — either the empty-state pill or the active chat.
                    The child owns its own rounded-glass panel + backdrop, so
                    we just render it inline; the frame provides only the
                    ambient background + sidebar. */}
                {children}
            </div>

            {/* Expose the currently-resolved per-chat override to ChatPane's
                ChatProfile panel via a hidden data element. Using props would
                require lifting ChatPane into ChatFrame's children as a
                function-child pattern, which breaks the RSC boundary. Instead
                ChatPane reads localStorage directly on mount + subscribes to
                the same `chat-bg-changed` event this frame dispatches. */}
            <span
                aria-hidden
                hidden
                data-chat-frame-active-bg={activeChatBgOverride ? "override" : "inherit"}
            />
        </main>
    );
}

/**
 * Parse `/chat/123` → 123 from the current pathname. Returns `null` for
 * any non-matching route (dashboard root, other tabs) so `activeChatId`
 * is a single source of truth for "is a chat currently open?".
 */
function parseActiveChatId(pathname: string | null): number | null {
    if (!pathname) return null;
    const match = pathname.match(/^\/chat\/(\d+)/);
    if (!match) return null;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Merge a server-refreshed chats array into our local state without stomping
 * transient optimistic edits. Rule: server wins for `lastMessageAt`,
 * `lastMessageText`, and `unreadCount`; local state wins for `pinned`,
 * `muted`, `archived` — those we've optimistically toggled via server
 * actions and the polled snapshot may be stale.
 */
function mergeChats(local: ChatRow[], server: ChatRow[]): ChatRow[] {
    const localById = new Map(local.map((c) => [c.id, c]));
    return server.map((incoming) => {
        const l = localById.get(incoming.id);
        if (!l) return incoming;
        return {
            ...incoming,
            pinned: l.pinned,
            muted: l.muted,
            archived: l.archived,
        };
    });
}
