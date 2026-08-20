"use client";

import { ReactNode } from "react";
import { toast } from "sonner";
import { Smile, Reply, CornerUpLeft, Copy, Trash2, Edit2 } from "lucide-react";
import { Bubble, BubbleContent, BubbleReactions } from "@/components/ui/bubble";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Reaction {
  emoji: string;
  count?: number;
}

interface ChatMessageProps {
  align?: "start" | "end";
  author?: string;
  authorInitials?: string;
  authorColorClass?: string;
  text?: string;
  time: string;
  isOwnMessage?: boolean;
  reactions?: Reaction[];
  children?: ReactNode;
  onReply?: (author: string, text: string) => void;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥"] as const;

export function ChatMessage({
  align = "start",
  author,
  authorInitials,
  authorColorClass = "bg-sky-500",
  text,
  time,
  isOwnMessage,
  reactions,
  children,
  onReply,
}: ChatMessageProps) {
  const isEnd = align === "end";
  const authorName = author || (isOwnMessage ? "You" : "User");
  const replyText = text || "Message";

  const handleReplyClick = () => {
    onReply?.(authorName, replyText);
  };

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  const bubbleClasses = align === "start"
    ? "rounded-[22px] rounded-bl-md px-4 py-2.5 text-sm leading-6"
    : "rounded-[22px] rounded-br-md px-4 py-2.5 text-sm leading-6";

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div className={`group/msg mb-3 flex items-end gap-2 ${isEnd ? 'relative justify-end' : ''}`}>

            {!isEnd && authorInitials && (
              <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ${authorColorClass}`}>
                {authorInitials}
              </span>
            )}

            <Bubble align={align} variant={isEnd ? "glass-primary" : "glass"} className={(isEnd || reactions?.length) ? 'mb-2' : ''}>
              <BubbleContent className={bubbleClasses}>
                {!isEnd && author && (
                  <p className={`mb-0.5 text-[13px] font-semibold text-${authorColorClass.split('-')[1]}-500`}>
                    {author}
                  </p>
                )}
                {children || <p>{text}</p>}
                <span className={`mt-1 block text-[11px] ${isEnd ? 'opacity-70' : 'text-muted-foreground'} text-right`}>
                  {time}
                </span>
              </BubbleContent>

              {reactions && reactions.length > 0 && (
                <BubbleReactions side="bottom" align={isEnd ? "start" : "end"} className={isEnd ? "-translate-x-2" : "translate-x-2"}>
                  {reactions.map((r, i) => (
                    <span key={i} className="flex items-center gap-0.5">
                      <span className="px-1 text-[11px]">{r.emoji}</span>
                      {r.count && <span className="px-1 text-[10px] font-medium">{r.count}</span>}
                    </span>
                  ))}
                </BubbleReactions>
              )}
            </Bubble>

            <div className={isEnd
              ? "absolute right-2 -bottom-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100"
              : `mb-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100 ${reactions?.length ? 'mb-4' : ''}`}>
              <Popover>
                <PopoverTrigger
                  aria-label="React"
                  className={`rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground ${isEnd ? 'bg-background shadow-sm border border-border' : ''}`}
                >
                  <Smile className="w-4 h-4" />
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="center"
                  className="w-auto flex items-center gap-1 rounded-full px-2 py-1"
                >
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="text-lg hover:scale-125 transition-transform px-1"
                      onClick={() => toast(`Reacted ${emoji}`)}
                    >
                      {emoji}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              <Tooltip>
                <TooltipTrigger
                  aria-label="Reply"
                  onClick={handleReplyClick}
                  className={`rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground ${isEnd ? 'bg-background shadow-sm border border-border' : ''}`}
                >
                  <Reply className="w-4 h-4" />
                </TooltipTrigger>
                <TooltipContent side="top">Reply</TooltipContent>
              </Tooltip>
            </div>

          </div>
        }
      />

      <ContextMenuContent className="w-48">
        <div className="flex items-center gap-1 justify-between border-b border-border/50 mb-1 pb-1">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="text-lg hover:scale-125 transition-transform px-1"
              onClick={() => toast(`Reacted ${emoji}`)}
            >
              {emoji}
            </button>
          ))}
        </div>
        <ContextMenuItem onClick={handleReplyClick}>
          <CornerUpLeft className="w-4 h-4" /> Reply
        </ContextMenuItem>
        {isEnd && (
          <ContextMenuItem>
            <Edit2 className="w-4 h-4" /> Edit
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={handleCopy}>
          <Copy className="w-4 h-4" /> Copy Text
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2 className="w-4 h-4" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
