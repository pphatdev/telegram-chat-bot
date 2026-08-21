"use client";

import { ArrowLeft, Search, EllipsisVertical, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { AvatarImage } from "@/features/chats/components/avatar-image";
import { Input } from "@/components/ui/input";

interface ChatHeaderProps {
  title: string;
  subtitle?: string;
  avatarText: string;
  avatarColor: string;
  /** Our internal chat.id — the avatar proxy is keyed on it. */
  chatId?: number;
  /** Optional callback invoked before navigating back — used by ChatPane to
   *  clear its transient search state so the pane starts fresh next time. */
  closeChat?: () => void;
  onProfileClick?: () => void;
  innerSearchQuery: string;
  setInnerSearchQuery: (query: string) => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
}

export function ChatHeader({ title, subtitle, avatarText, avatarColor, chatId, closeChat, onProfileClick, innerSearchQuery, setInnerSearchQuery, isSearchOpen, setIsSearchOpen }: ChatHeaderProps) {
  const router = useRouter();
  return (
    <header className="h-17 min-w-93.75 w-full z-20 bg-background/50 drop-shadow-2xl backdrop-blur-sm">
      <div className="flex h-full gap-2 max-w-5xl w-full mx-auto px-4 sm:px-5 items-center ">
        <button
          onClick={() => {
            // Let the pane clear any transient state (search open, filter
            // text) first, then navigate back to the dashboard root.
            if (closeChat) {
              closeChat();
            } else {
              router.push("/");
            }
          }}
          aria-label="Back to chats"
          className="rounded-full p-2 text-muted-foreground hover:bg-accent shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {isSearchOpen ? (
          <div className="flex-1 flex items-center gap-2 bg-black/5 dark:bg-white/5 border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.02)_inset] rounded-[20px] px-3 py-1.5 animate-in fade-in slide-in-from-right-4 duration-200 min-w-0">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              type="text"
              autoFocus
              placeholder="Search in this chat..."
              className="h-auto border-0 bg-transparent p-0 shadow-none text-[15px] focus-visible:ring-0 focus-visible:border-0"
              value={innerSearchQuery}
              onChange={(e) => setInnerSearchQuery(e.target.value)}
            />
            <button onClick={() => { setIsSearchOpen(false); setInnerSearchQuery(''); }} className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground shrink-0 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div
            className="flex min-w-0 flex-1 items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity animate-in fade-in duration-200"
            onClick={onProfileClick}
          >
            {chatId ? (
              <AvatarImage
                src={`/api/avatar/chat/${chatId}`}
                alt={title}
                className="size-10 shrink-0 rounded-full"
                fallback={
                  <span className={`absolute inset-0 grid place-items-center text-sm font-semibold text-white ${avatarColor}`}>{avatarText}</span>
                }
              />
            ) : (
              <span className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white ${avatarColor}`}>{avatarText}</span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold">{title}</h1>
              {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
            </div>
          </div>
        )}

        {!isSearchOpen && (
          <div className="flex items-center gap-1 shrink-0 animate-in fade-in duration-200">
            <button onClick={() => setIsSearchOpen(true)} aria-label="Search in conversation" className="rounded-full p-2 text-muted-foreground hover:bg-accent transition-colors">
              <Search className="w-5 h-5" />
            </button>
            <button aria-label="More options" className="rounded-full p-2 text-muted-foreground hover:bg-accent transition-colors">
              <EllipsisVertical className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
