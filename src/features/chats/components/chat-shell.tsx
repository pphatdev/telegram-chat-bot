"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChatSidebar } from "@/features/chats/components/chat-sidebar";
import { ChatHeader } from "@/features/chats/components/chat-header";
import { ChatMessage } from "@/features/chats/components/chat-message";
import { ChatInput } from "@/features/chats/components/chat-input";
import { ChatProfile } from "@/features/chats/components/chat-profile";
import { PasscodeLock } from "@/features/auth/components/passcode-lock";
import { loadMessages, markChatAsRead, refreshChats } from "@/features/chats/actions";
import { useChatFeed } from "@/features/chats/hooks/use-chat-feed";

import type { ChatRow, MessageRow } from "@/db/schema";

interface ChatShellProps {
  initialChats: ChatRow[];
}

/**
 * Client shell for the dashboard. Owns every piece of interactive state that
 * used to live in `page.tsx`:
 *   - Which chat is active, which panes are visible on mobile, sidebar width,
 *     reply-to state, emoji picker tab, passcode lock state.
 *   - The messages array for the active chat — fetched via `loadMessages`
 *     server action whenever `activeChatId` changes.
 *   - The chats array — seeded from `initialChats` (server-fetched) and
 *     mutated optimistically for pin/mute/etc. via chat-sidebar's own
 *     server-action callers.
 */
export function ChatShell({ initialChats }: ChatShellProps) {
  const [chats, setChats] = useState<ChatRow[]>(initialChats);
  const [mobileView, setMobileView] = useState<"sidebar" | "chat">("sidebar");
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(330);
  const [innerSearchQuery, setInnerSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ author: string; text: string } | null>(null);
  const [activeEmojiTab, setActiveEmojiTab] = useState<"emoji" | "sticker" | "gif">("emoji");
  const [isLocked, setIsLocked] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleReply = useCallback((author: string, text: string) => {
    setReplyTo({ author, text });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Load messages whenever the active chat changes.
  useEffect(() => {
    if (activeChatId === null) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    (async () => {
      const result = await loadMessages(activeChatId);
      if (cancelled) return;
      if (result.ok) {
        setMessages(result.data);
      } else {
        toast.error(result.error);
      }
      setLoadingMessages(false);
    })();
    // Also mark the chat as read + optimistically clear the unread badge.
    setChats((prev) => prev.map((c) => (c.id === activeChatId ? { ...c, unreadCount: 0 } : c)));
    void markChatAsRead(activeChatId);
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        setIsLocked(true);
        return;
      }
      if (e.key === "Escape") {
        if (showProfile) {
          setShowProfile(false);
        } else if (activeChatId !== null) {
          setActiveChatId(null);
          setMobileView("sidebar");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeChatId, showProfile]);

  useEffect(() => {
    if (!showProfile) return;
    const checkWidth = () => {
      if (window.innerWidth >= 1024 && window.innerWidth < sidebarWidth + 725) {
        setShowProfile(false);
      }
    };
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, [sidebarWidth, showProfile]);

  /**
   * Realtime refresh via ChatFeedHub DO WebSocket. The hook falls back to
   * polling when the socket can't connect (`next dev` without the DO
   * binding, network hiccups, unauthenticated). On every "chats-updated"
   * signal we re-pull the sidebar list and — if a chat is open — its thread.
   */
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;

  const refreshFromSignal = useCallback(async () => {
    const chatsResult = await refreshChats();
    if (chatsResult.ok) {
      setChats((prev) => mergeChats(prev, chatsResult.data));
    }
    const currentActive = activeChatIdRef.current;
    if (currentActive !== null) {
      const msgResult = await loadMessages(currentActive);
      if (msgResult.ok) setMessages(msgResult.data);
    }
  }, []);

  useChatFeed(refreshFromSignal);

  const filteredMessages = useMemo(() => {
    const q = innerSearchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => (m.text ?? "").toLowerCase().includes(q));
  }, [messages, innerSearchQuery]);

  const handleMessageSent = useCallback((row: MessageRow) => {
    setMessages((prev) => [...prev, row]);
    setChats((prev) =>
      prev.map((c) =>
        c.id === row.chatId
          ? { ...c, lastMessageText: row.text ?? "", lastMessageAt: row.sentAt }
          : c,
      ),
    );
    setReplyTo(null);
  }, []);

  const activeChat = activeChatId ? chats.find((c) => c.id === activeChatId) ?? null : null;

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
          mobileView={mobileView}
          setMobileView={setMobileView}
          activeChatId={activeChatId}
          setActiveChatId={setActiveChatId}
          sidebarWidth={sidebarWidth}
          setSidebarWidth={setSidebarWidth}
        />

        {activeChat === null ? (
          <section
            className={`bg-background/40 backdrop-blur-3xl rounded-[32px] shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] min-w-93.75 flex-1 flex-col overflow-hidden relative ${mobileView === "chat" ? "flex animate-in fade-in slide-in-from-right-8 lg:animate-none duration-300" : "hidden lg:flex"}`}
          >
            <div className="flex flex-1 items-center justify-center relative z-10">
              <div className="bg-black/5 dark:bg-white/5 backdrop-blur-md rounded-full px-6 py-2 text-[14px] font-medium text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.02)_inset] border border-white/10">
                {chats.length === 0
                  ? "No conversations yet — messages will appear here as your bot receives them."
                  : "Select a chat to start messaging"}
              </div>
            </div>
          </section>
        ) : (
          <>
            <section
              className={`bg-background/40 backdrop-blur-3xl rounded-[32px] shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] min-w-93.75 flex-1 flex-col overflow-hidden relative ${mobileView === "chat" && !showProfile ? "flex animate-in fade-in slide-in-from-right-8 lg:animate-none duration-300" : "hidden lg:flex"}`}
            >
              <ChatHeader
                title={activeChat.title}
                avatarText={activeChat.avatarText ?? activeChat.title.slice(0, 2)}
                avatarColor={activeChat.avatarColor ?? "bg-sky-500"}
                subtitle={activeChat.type === "private" ? "Private chat" : `${activeChat.type} conversation`}
                setMobileView={setMobileView}
                closeChat={() => {
                  setActiveChatId(null);
                  setMobileView("sidebar");
                  setIsSearchOpen(false);
                  setInnerSearchQuery("");
                }}
                onProfileClick={() => setShowProfile(!showProfile)}
                innerSearchQuery={innerSearchQuery}
                setInnerSearchQuery={setInnerSearchQuery}
                isSearchOpen={isSearchOpen}
                setIsSearchOpen={setIsSearchOpen}
              />

              <div className="mx-auto flex w-full max-w-4xl min-w-93.75 flex-1 flex-col overflow-hidden px-3 sm:px-8">
                <div className="flex-1 overflow-y-auto py-6">
                  {loadingMessages ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">Loading messages…</div>
                  ) : filteredMessages.length === 0 ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">
                      {innerSearchQuery ? "No matches in this thread." : "No messages yet."}
                    </div>
                  ) : (
                    filteredMessages.map((msg) => (
                      <ChatMessage
                        key={msg.id}
                        author={msg.direction === "in" ? msg.authorName ?? undefined : undefined}
                        authorInitials={msg.direction === "in" ? initials(msg.authorName ?? "") : undefined}
                        authorColorClass="bg-sky-500"
                        text={msg.text ?? ""}
                        time={formatTime(msg.sentAt)}
                        align={msg.direction === "out" ? "end" : "start"}
                        isOwnMessage={msg.direction === "out"}
                        onReply={handleReply}
                      />
                    ))
                  )}
                </div>

                <ChatInput
                  activeChatId={activeChat.id}
                  replyTo={replyTo}
                  setReplyTo={setReplyTo}
                  inputRef={inputRef}
                  activeEmojiTab={activeEmojiTab}
                  setActiveEmojiTab={setActiveEmojiTab}
                  onMessageSent={handleMessageSent}
                />
              </div>
            </section>

            {showProfile && (
              <div
                className={
                  mobileView === "chat"
                    ? "absolute inset-0 z-50 flex md:items-center md:justify-center md:bg-black/20 md:backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none lg:static lg:block lg:w-auto lg:h-auto"
                    : "hidden lg:block"
                }
              >
                <ChatProfile
                  chat={activeChat}
                  onClose={() => setShowProfile(false)}
                  onChatDeleted={(id) => {
                    setChats((prev) => prev.filter((c) => c.id !== id));
                    setActiveChatId(null);
                    setMobileView("sidebar");
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
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
