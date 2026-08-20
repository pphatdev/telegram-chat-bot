"use client";

import { Search, Menu, Settings, Shield, Pin, PinOff, Archive, MessageCircle, BellOff, Trash2, Megaphone, History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { ChatRow } from "@/db/schema";
import {
  archiveChat,
  deleteChat,
  markChatAsUnread,
  toggleMuteChat,
  togglePinChat,
} from "@/features/chats/actions";
import { BroadcastComposer } from "@/features/broadcast/components/broadcast-composer";
import { SettingsModal } from "@/features/settings/components/settings-modal";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ChatSidebarProps {
  chats: ChatRow[];
  setChats: React.Dispatch<React.SetStateAction<ChatRow[]>>;
  mobileView: 'sidebar' | 'chat';
  setMobileView: (view: 'sidebar' | 'chat') => void;
  activeChatId: number | null;
  setActiveChatId: (id: number) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
}

type ChatFilter = 'All' | 'Private' | 'Group' | 'Channel';
const TABS: ChatFilter[] = ['All', 'Private', 'Group', 'Channel'];

export function ChatSidebar({
  chats,
  setChats,
  mobileView,
  setMobileView,
  activeChatId,
  setActiveChatId,
  sidebarWidth,
  setSidebarWidth,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<ChatFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState<string | undefined>(undefined);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('dark');
  const [font, setFont] = useState<'inter' | 'geist' | 'kantumruy' | 'opensans' | 'sans-serif'>('inter');
  const [scale, setScale] = useState<number>(100);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 280), 600);
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isResizing, setSidebarWidth]);

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    document.documentElement.style.fontSize = `${newScale * 0.85}%`;
  };

  const handleFontChange = (newFont: 'inter' | 'geist' | 'kantumruy' | 'opensans' | 'sans-serif') => {
    setFont(newFont);
    if (newFont === 'geist') {
      document.documentElement.style.setProperty('--font-sans', 'var(--font-geist-sans)');
    } else if (newFont === 'kantumruy') {
      document.documentElement.style.setProperty('--font-sans', 'var(--font-kantumruy-pro)');
    } else if (newFont === 'opensans') {
      document.documentElement.style.setProperty('--font-sans', 'var(--font-open-sans)');
    } else if (newFont === 'sans-serif') {
      document.documentElement.style.setProperty('--font-sans', 'sans-serif');
    } else {
      document.documentElement.style.removeProperty('--font-sans');
    }
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (newTheme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return chats
      .filter((c) => !c.archived)
      .filter((c) => {
        const matchesTab =
          activeTab === 'All' ||
          (activeTab === 'Private' && c.type === 'private') ||
          (activeTab === 'Group' && (c.type === 'group' || c.type === 'supergroup')) ||
          (activeTab === 'Channel' && c.type === 'channel');
        if (!matchesTab) return false;
        if (!q) return true;
        return (
          c.title.toLowerCase().includes(q) ||
          (c.lastMessageText ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
      });
  }, [chats, searchQuery, activeTab]);

  /** Optimistic pin toggle: mutate local state first, revert on server error. */
  const togglePin = async (chatId: number) => {
    let previous = false;
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        previous = c.pinned;
        toast(!previous ? `Pinned "${c.title}"` : `Unpinned "${c.title}"`);
        return { ...c, pinned: !previous };
      }),
    );
    const result = await togglePinChat(chatId, !previous);
    if (!result.ok) {
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinned: previous } : c)));
      toast.error(result.error);
    }
  };

  const runAction = async (
    chatId: number,
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
    optimistic?: () => void,
    rollback?: () => void,
  ) => {
    optimistic?.();
    const result = await action();
    if (result.ok) {
      toast(successMessage);
    } else {
      rollback?.();
      toast.error(result.error ?? "Something went wrong");
    }
  };

  const handleMarkUnread = (chat: ChatRow) => {
    runAction(
      chat.id,
      () => markChatAsUnread(chat.id),
      `Marked "${chat.title}" as unread`,
      () => setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: Math.max(1, c.unreadCount) } : c))),
      () => setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: 0 } : c))),
    );
  };

  const handleMuteToggle = (chat: ChatRow) => {
    const next = !chat.muted;
    runAction(
      chat.id,
      () => toggleMuteChat(chat.id, next),
      next ? `Muted "${chat.title}"` : `Unmuted "${chat.title}"`,
      () => setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, muted: next } : c))),
      () => setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, muted: !next } : c))),
    );
  };

  const handleArchive = (chat: ChatRow) => {
    runAction(
      chat.id,
      () => archiveChat(chat.id, true),
      `Archived "${chat.title}"`,
      () => setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, archived: true } : c))),
      () => setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, archived: false } : c))),
    );
  };

  const handleDelete = (chat: ChatRow) => {
    const snapshot = chats;
    setChats((prev) => prev.filter((c) => c.id !== chat.id));
    (async () => {
      const result = await deleteChat(chat.id);
      if (!result.ok) {
        setChats(snapshot);
        toast.error(result.error);
      } else {
        toast(`Deleted "${chat.title}"`);
      }
    })();
  };

  return (
    <aside
      className={`relative shrink-0 w-full lg:w-(--sidebar-width) flex-col overflow-hidden lg:rounded-[32px] lg:border border-white/10 bg-background/40 backdrop-blur-3xl shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] ${mobileView === 'sidebar' ? 'flex animate-in fade-in slide-in-from-left-8 lg:animate-none duration-300' : 'hidden lg:flex'}`}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <div
        className="hidden lg:block absolute top-0 bottom-0 right-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors z-60"
        onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
      />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-2 border-b border-white/10 bg-transparent sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => { setSettingsView(undefined); setShowSettings(true); }} aria-label="Menu" className="grid size-9 place-items-center rounded-full bg-accent hover:bg-accent/80 active:scale-95 transition-all lg:hidden">
              <Menu className="w-4.5 h-4.5 text-foreground" />
            </button>
            <h1 className="text-[26px] font-bold tracking-tight text-foreground">Chats</h1>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                aria-label="New broadcast"
                onClick={() => setShowBroadcast(true)}
                className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm active:scale-95 transition-all hover:opacity-90"
              >
                <Megaphone className="w-4.5 h-4.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">New broadcast</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                aria-label="Settings"
                onClick={() => { setSettingsView('profile'); setShowSettings(true); }}
                className="size-9 rounded-full overflow-hidden shadow-sm border border-border/50 hover:ring-2 hover:ring-primary/50 active:scale-95 transition-all bg-muted"
              >
                <img src="https://github.com/pphatdev.png" alt="Profile avatar" className="w-full h-full object-cover" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Open profile & settings</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <label className="flex items-center gap-2 rounded-[20px] bg-black/5 dark:bg-white/5 px-3 py-2.5 text-sm text-muted-foreground focus-within:bg-background/80 focus-within:ring-4 focus-within:ring-primary/20 transition-all border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.02)_inset]">
          <Search className="w-4 h-4 text-muted-foreground/70" />
          <Input
            className="h-auto border-0 bg-transparent p-0 shadow-none text-sm font-medium placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:border-0"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ChatFilter)} className="w-full">
          <TabsList
            variant="line"
            className="w-full justify-start gap-2 overflow-x-auto pb-1 h-auto p-0 bg-transparent"
          >
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="whitespace-nowrap rounded-[18px] px-4 py-1.5 text-[13px] font-semibold border border-white/5 bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10 data-active:bg-background/80 data-active:text-foreground data-active:shadow-[0_2px_10px_rgba(0,0,0,0.1),0_1px_1px_rgba(255,255,255,0.2)_inset] data-active:border-white/10 flex-none"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <nav aria-label="Chats" className="flex-1 overflow-y-auto py-2">
        {filteredChats.length === 0 && (
          <div className="text-center text-sm text-muted-foreground px-4 py-8">
            {chats.length === 0
              ? "No conversations yet. Once your bot receives a message it will appear here."
              : "No chats match your filters."}
          </div>
        )}
        {filteredChats.map((chat) => (
          <ContextMenu key={chat.id}>
            <ContextMenuTrigger
              render={
                <div className="group relative">
                  <button
                    onClick={() => {
                      setActiveChatId(chat.id);
                      setMobileView('chat');
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-accent/60 ${activeChatId === chat.id ? 'bg-accent' : ''}`}
                  >
                    <span className={`grid size-12 shrink-0 place-items-center rounded-full text-sm font-semibold text-white ${chat.avatarColor ?? 'bg-slate-500'}`}>
                      {chat.avatarText ?? chat.title.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[15px] font-medium">{chat.title}</span>
                          {chat.pinned && (
                            <Pin className="w-3.5 h-3.5 text-muted-foreground shrink-0 fill-muted-foreground/30" />
                          )}
                          <Badge
                            variant="secondary"
                            className="h-4 shrink-0 bg-primary/10 text-primary px-1.5 text-[10px] border-transparent capitalize"
                          >
                            {chat.type}
                          </Badge>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelative(chat.lastMessageAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="block truncate text-sm text-muted-foreground flex-1">
                          {chat.lastMessageText ?? " "}
                        </span>
                        {chat.unreadCount > 0 && (
                          <Badge className="h-5 min-w-5 shrink-0 justify-center rounded-full text-[10px] px-1.5">
                            {chat.unreadCount}
                          </Badge>
                        )}
                      </span>
                    </span>
                  </button>
                  <Tooltip>
                    <TooltipTrigger
                      onClick={(e) => { e.stopPropagation(); togglePin(chat.id); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-background border border-border/50 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground hover:bg-accent shadow-sm"
                      aria-label={chat.pinned ? "Unpin chat" : "Pin chat"}
                    >
                      {chat.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                    </TooltipTrigger>
                    <TooltipContent side="left">{chat.pinned ? 'Unpin' : 'Pin'}</TooltipContent>
                  </Tooltip>
                </div>
              }
            />
            <ContextMenuContent className="w-56 bg-card/95 backdrop-blur-md border border-white/10">
              <ContextMenuItem onClick={() => handleArchive(chat)}>
                <Archive className="w-4 h-4 text-muted-foreground" /> Archive
              </ContextMenuItem>
              <ContextMenuItem onClick={() => togglePin(chat.id)}>
                {chat.pinned ? (
                  <>
                    <PinOff className="w-4 h-4 text-muted-foreground" /> Unpin
                  </>
                ) : (
                  <>
                    <Pin className="w-4 h-4 text-muted-foreground" /> Pin
                  </>
                )}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleMarkUnread(chat)}>
                <MessageCircle className="w-4 h-4 text-muted-foreground" /> Mark as Unread
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleMuteToggle(chat)}>
                <BellOff className="w-4 h-4 text-muted-foreground" /> {chat.muted ? "Unmute" : "Mute"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => handleDelete(chat)}>
                <Trash2 className="w-4 h-4" /> Delete Chat
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </nav>
      <div className="hidden lg:block border-t border-border p-3">
        <button onClick={() => { setSettingsView(undefined); setShowSettings(true); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          <Settings className="w-4 h-4" /> Settings
        </button>
        <button onClick={() => { setSettingsView('access-control'); setShowSettings(true); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          <Shield className="w-4 h-4" /> Whitelist & Blacklist
        </button>
        <Link href="/broadcasts" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          <History className="w-4 h-4" /> Broadcast History
        </Link>
      </div>

      <SettingsModal
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        initialView={settingsView}
        theme={theme}
        handleThemeChange={handleThemeChange}
        font={font}
        handleFontChange={handleFontChange}
        scale={scale}
        handleScaleChange={handleScaleChange}
      />

      <BroadcastComposer
        open={showBroadcast}
        onOpenChange={setShowBroadcast}
        chats={chats}
      />
    </aside>
  );
}

function formatRelative(unixSeconds: number | null): string {
  if (!unixSeconds) return "";
  const now = Date.now();
  const then = unixSeconds * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const delta = now - then;
  if (delta < dayMs) {
    return new Date(then).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (delta < 7 * dayMs) {
    return new Date(then).toLocaleDateString([], { weekday: "long" });
  }
  return new Date(then).toLocaleDateString([], { month: "short", day: "numeric" });
}
