"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, AtSign, Hash, Info, Bell, Image, FileText, Mic, Trash2, Ban } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ChatRow } from "@/db/schema";
import { archiveChat, deleteChat, toggleMuteChat } from "@/features/chats/actions";
import { loadChatMessageCounts } from "@/features/settings/actions";
import type { ChatMessageCounts } from "@/features/settings/queries";

interface ChatProfileProps {
  chat: ChatRow;
  onClose: () => void;
  /** Optional callback so the shell can drop the chat from state after delete. */
  onChatDeleted?: (chatId: number) => void;
}

export function ChatProfile({ chat, onClose, onChatDeleted }: ChatProfileProps) {
  const [muted, setMuted] = useState(chat.muted);
  const [counts, setCounts] = useState<ChatMessageCounts | null>(null);

  useEffect(() => {
    setMuted(chat.muted);
  }, [chat.muted]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadChatMessageCounts(chat.id);
      if (!cancelled && result.ok) setCounts(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [chat.id]);

  const handleMuteToggle = async (next: boolean) => {
    setMuted(next);
    const result = await toggleMuteChat(chat.id, next);
    if (!result.ok) {
      setMuted(!next);
      toast.error(result.error);
    }
  };

  const handleBlock = async () => {
    const result = await archiveChat(chat.id, true);
    if (result.ok) {
      toast(`Archived "${chat.title}"`);
      onClose();
    } else {
      toast.error(result.error);
    }
  };

  const handleDelete = async () => {
    const result = await deleteChat(chat.id);
    if (result.ok) {
      toast(`Deleted "${chat.title}"`);
      onChatDeleted?.(chat.id);
      onClose();
    } else {
      toast.error(result.error);
    }
  };

  const initials = chat.avatarText ?? chat.title.slice(0, 2).toUpperCase();
  const avatarColor = chat.avatarColor ?? "bg-sky-500";
  const subtitle = describeSubtitle(chat);

  return (
    <aside className="flex w-full h-full md:w-100 md:h-[85vh] lg:w-87.5 lg:h-full md:rounded-[32px] lg:rounded-[32px] shrink-0 flex-col overflow-hidden bg-background/40 backdrop-blur-3xl border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] animate-in slide-in-from-bottom-8 md:zoom-in-95 lg:zoom-in-100 lg:slide-in-from-right-8 duration-300 relative">
      <div className="flex-1 overflow-y-auto relative">
        <button onClick={onClose} aria-label="Close profile" className="absolute top-4 right-4 z-50 rounded-full p-2 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
          <X className="w-5 h-5" />
        </button>

        {/* Profile Header */}
        <div className="flex flex-col items-center pt-10 pb-8 border-b border-white/5 bg-black/5 dark:bg-white/5 relative">
          <div className={`grid size-24 place-items-center rounded-full text-3xl font-semibold text-white shadow-md mb-4 ${avatarColor}`}>
            {initials}
          </div>
          <h1 className="text-xl font-semibold text-center px-4">{chat.title}</h1>
          <p className="text-[14px] text-muted-foreground mt-1 capitalize">{subtitle}</p>
        </div>

        {/* Info Section */}
        <div className="p-4 border-b border-white/5">
          <div className="text-[13px] font-semibold text-primary mb-3">Info</div>
          {chat.username && (
            <div className="flex items-center gap-4 mb-4">
              <AtSign className="w-5 h-5 text-muted-foreground" />
              <div>
                <div className="text-[15px] font-medium">@{chat.username}</div>
                <div className="text-[13px] text-muted-foreground">Username</div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-4 mb-4">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-[15px] font-medium font-mono">{chat.telegramChatId}</div>
              <div className="text-[13px] text-muted-foreground">Telegram Chat ID</div>
            </div>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <Info className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-[15px] font-medium capitalize">{chat.type}</div>
              <div className="text-[13px] text-muted-foreground">Chat type</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Bell className="w-5 h-5 text-muted-foreground" />
              <div className="text-[15px] font-medium">Notifications</div>
            </div>
            <Switch checked={!muted} onCheckedChange={(on) => handleMuteToggle(!on)} />
          </div>
        </div>

        {/* Shared Media */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-primary">Shared Media</div>
          </div>
          <SharedMediaRow icon={<Image className="w-5 h-5" />} color="text-blue-500" bg="bg-blue-500/10" label="Photos and Videos" count={counts?.photosAndVideos} />
          <SharedMediaRow icon={<FileText className="w-5 h-5" />} color="text-emerald-500" bg="bg-emerald-500/10" label="Files" count={counts?.files} />
          <SharedMediaRow icon={<Mic className="w-5 h-5" />} color="text-purple-500" bg="bg-purple-500/10" label="Voice / Audio" count={counts?.audio} />
        </div>

        {/* Actions */}
        <div className="p-4">
          <button onClick={handleBlock} className="flex w-full items-center gap-4 py-2.5 text-left hover:bg-destructive/10 rounded-lg px-2 -mx-2 transition-colors text-destructive">
            <Ban className="w-5 h-5" />
            <div className="text-[15px] font-medium">Archive Chat</div>
          </button>
          <button onClick={handleDelete} className="flex w-full items-center gap-4 py-2.5 text-left hover:bg-destructive/10 rounded-lg px-2 -mx-2 transition-colors text-destructive">
            <Trash2 className="w-5 h-5" />
            <div className="text-[15px] font-medium">Delete Chat</div>
          </button>
        </div>
      </div>
    </aside>
  );
}

function SharedMediaRow({
  icon,
  color,
  bg,
  label,
  count,
}: {
  icon: React.ReactNode;
  color: string;
  bg: string;
  label: string;
  count: number | undefined;
}) {
  return (
    <button className="flex w-full items-center justify-between py-2.5 text-left hover:bg-accent/50 rounded-lg px-2 -mx-2 transition-colors">
      <div className="flex items-center gap-4">
        <div className={`grid size-9 place-items-center rounded-lg ${bg} ${color}`}>{icon}</div>
        <div className="text-[15px] font-medium">
          {count === undefined ? label : `${count} ${label}`}
        </div>
      </div>
    </button>
  );
}

function describeSubtitle(chat: ChatRow): string {
  if (chat.type === "private") return "Private chat";
  if (chat.type === "supergroup") return "Supergroup";
  return `${chat.type} conversation`;
}
