"use client";

import { ReactNode, useState } from "react";
import { toast } from "sonner";
import { Smile, Reply, CornerUpLeft, Copy, Trash2, Edit2, Loader2, AlertCircle } from "lucide-react";
import { AvatarImage } from "@/features/chats/components/avatar-image";
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

export interface Reaction {
  emoji: string;
  count?: number;
  /** True when the bot has this emoji set as its own reaction. */
  byBot?: boolean;
}

export interface ReplyTarget {
  author: string;
  text: string;
  /**
   * Telegram-side message id — this is what Telegram's Bot API wants in
   * `reply_to_message_id`. Our own DB row's `messages.id` is useless for the
   * wire call. Nullable because the messages table allows telegram_message_id
   * to be null (failed sends never got assigned one), and you can't reply to
   * a message that Telegram never received.
   */
  telegramMessageId: number;
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
  /**
   * Telegram-side id needed for `reply_to_message_id`. When null, the Reply
   * affordance is hidden — usually the message failed to send and Telegram
   * never assigned it an id, so there's nothing to reply to.
   */
  telegramMessageId?: number | null;
  /**
   * Telegram user id of the author. When present we render their profile
   * avatar via `/api/avatar/user/[id]`; otherwise we fall back to colored
   * initials (bot messages, anonymous channel posts).
   */
  authorTelegramId?: number | null;
  onReply?: (target: ReplyTarget) => void;
  /**
   * Set (or clear) the bot's reaction. `nextEmoji === null` removes the
   * bot's current reaction. Absent when reactions are unavailable — the
   * quick-react popover and context row are hidden in that case.
   */
  onReact?: (nextEmoji: string | null) => void;
  /**
   * Delivery status for outgoing bubbles — surfaced next to the timestamp
   * so the sender can distinguish an optimistic in-flight bubble from a
   * confirmed send and from a hard failure. Inbound messages ignore this.
   * `undefined`/omitted renders no indicator (default happy path).
   */
  status?: "sending" | "sent" | "delivered" | "read" | "failed" | null;
  /** Human-readable reason a `status:'failed'` row failed. Shown as a
   *  tooltip on the warning icon. */
  failureReason?: string | null;
  /** Message kind — drives media rendering (sticker, photo, …). Absent or
   *  `"text"` means no media block; only the `text` prop is rendered. */
  kind?: "text" | "photo" | "video" | "audio" | "sticker" | "document" | "location" | "contact" | null;
  /** Playable/browsable URL for the media (`.mediaR2Key` from the row).
   *  For our own sent stickers this is the absolute public URL we passed
   *  to Telegram; for R2-stored uploads it's the `/api/media/…` proxy. */
  mediaUrl?: string | null;
  /** MIME type when known — used to decide `<video>` vs `<img>` for
   *  stickers (Telegram supports both webm-video and webp-image stickers). */
  mediaMimeType?: string | null;
  /**
   * Preview of the message this one is replying to. When present, a compact
   * quote chip renders at the top of the bubble. `null`/undefined = not a
   * reply, or the parent was outside the currently-loaded window (in which
   * case a minimal placeholder chip could be rendered — currently we hide it).
   */
  replyPreview?: {
    author: string;
    text: string;
    /** Telegram id of the parent — used by `onJumpToMessage` to scroll. */
    telegramMessageId: number;
  } | null;
  /** Jump-and-flash the parent message. Wired by the shell against a
   *  telegram_message_id → DOM lookup. */
  onJumpToMessage?: (telegramMessageId: number) => void;
}

/**
 * Quick-react shortcuts. **Must** be exact code-point matches for
 * `TELEGRAM_BOT_REACTION_EMOJIS` in `../reactions.ts`:
 *   - `❤` with NO variation selector (VS16) — the `❤️` form is REACTION_INVALID.
 *   - `🤣` (rolling on floor laughing) — `😂` (face with tears of joy) is NOT
 *     in Telegram's bot-reactions allowlist.
 */
const QUICK_REACTIONS = ["👍", "❤", "🤣", "🔥"] as const;

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
  telegramMessageId,
  authorTelegramId,
  onReply,
  onReact,
  status,
  failureReason,
  kind,
  mediaUrl,
  mediaMimeType,
  replyPreview,
  onJumpToMessage,
}: ChatMessageProps) {
  const isSticker = kind === "sticker" && !!mediaUrl;
  // Video vs image sticker: prefer explicit MIME, then fall back to URL
  // extension. Telegram sends webm-video and webp/tgs-image stickers; we
  // handle webm-video + any image (webp/png/jpg) here. `.tgs` (Lottie
  // animated) needs a separate player and stays as a static placeholder.
  const isStickerVideo = isSticker && (
    (mediaMimeType && mediaMimeType.startsWith("video/")) ||
    /\.(webm|mp4)(\?|#|$)/i.test(mediaUrl ?? "")
  );
  const isEnd = align === "end";
  const authorName = author || (isOwnMessage ? "You" : "User");
  const replyText = text || "Message";
  const canReply = typeof telegramMessageId === "number";
  /** Bot can only react to messages Telegram has already assigned an id to. */
  const canReact = typeof telegramMessageId === "number" && typeof onReact === "function";
  const botEmoji = reactions?.find((r) => r.byBot)?.emoji ?? null;

  const handleReplyClick = () => {
    if (!canReply || !telegramMessageId) return;
    onReply?.({ author: authorName, text: replyText, telegramMessageId });
  };

  /**
   * Quick-react handler. Clicking the same emoji as the bot's current
   * reaction removes it (Telegram's convention); clicking a different one
   * replaces it. Both cases route through the same server action.
   */
  const handleReactClick = (emoji: string) => {
    if (!canReact) return;
    onReact?.(botEmoji === emoji ? null : emoji);
    setReactPickerOpen(false);
  };

  /**
   * Click-driven quick-react popover. The Popover primitive handles the
   * click-to-toggle and outside-click-to-close on its own; we only track
   * the open state locally so the surrounding action row stays visible
   * while the picker is open (see the `reactPickerOpen` branch below —
   * without it, the row's `group-hover/msg:opacity-100` would unset the
   * moment the cursor leaves the message wrapper to enter the popover,
   * fading the trigger out from under the pointer).
   */
  const [reactPickerOpen, setReactPickerOpen] = useState(false);

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
          <div
            data-tg-msg-id={telegramMessageId ?? undefined}
            className={`group/msg mb-3 flex items-end gap-2 transition-colors duration-500 rounded-2xl -mx-1 px-1 ${isEnd ? 'relative justify-end' : ''}`}
          >

            {!isEnd && authorInitials && (
              authorTelegramId ? (
                <AvatarImage
                  src={`/api/avatar/user/${authorTelegramId}`}
                  alt={author ?? "author"}
                  className="size-8 shrink-0 rounded-full"
                  fallback={
                    <span className={`absolute inset-0 grid place-items-center text-xs font-semibold text-white ${authorColorClass}`}>
                      {authorInitials}
                    </span>
                  }
                />
              ) : (
                <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ${authorColorClass}`}>
                  {authorInitials}
                </span>
              )
            )}

            <Bubble
              align={align}
              variant={isSticker ? "ghost" : (isEnd ? "glass-primary" : "glass")}
              className={`${(isEnd || reactions?.length) ? 'mb-2' : ''} ${status === 'sending' ? 'opacity-70' : ''} ${status === 'failed' ? 'ring-1 ring-destructive/50' : ''}`}
            >
              <BubbleContent className={isSticker ? "p-0! bg-transparent! flex flex-col gap-1" : bubbleClasses}>
                {!isEnd && author && (
                  <p className={`mb-0.5 text-[13px] font-semibold text-${authorColorClass.split('-')[1]}-500`}>
                    {author}
                  </p>
                )}
                {replyPreview && (
                  <button
                    type="button"
                    onClick={() => onJumpToMessage?.(replyPreview.telegramMessageId)}
                    title={`Jump to ${replyPreview.author}'s message`}
                    className={`group/reply mb-1.5 flex w-full items-stretch gap-2 rounded-lg pl-1.5 pr-2 py-1.5 text-left transition-colors ${
                      isEnd
                        ? 'bg-white/15 hover:bg-white/25'
                        : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`w-[3px] shrink-0 rounded-full self-stretch ${isEnd ? 'bg-white/80' : 'bg-primary'}`}
                    />
                    <span className="min-w-0 flex-1 flex flex-col justify-center leading-tight">
                      <span className={`text-[12px] font-semibold truncate ${isEnd ? 'text-white/95' : 'text-primary'}`}>
                        {replyPreview.author}
                      </span>
                      <span className={`text-[12px] truncate ${isEnd ? 'text-white/80' : 'text-muted-foreground'}`}>
                        {replyPreview.text || 'Message'}
                      </span>
                    </span>
                  </button>
                )}
                {isSticker ? (
                  isStickerVideo ? (
                    <video
                      src={mediaUrl!}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="size-32 object-contain pointer-events-none"
                    />
                  ) : (
                    <img
                      src={mediaUrl!}
                      alt={text || "Sticker"}
                      className="size-32 object-contain pointer-events-none"
                    />
                  )
                ) : (
                  children || (text ? <p>{text}</p> : null)
                )}
                <span className={`flex items-center justify-end gap-1 leading-4 text-[11px] ${isSticker ? 'text-muted-foreground' : (isEnd ? 'opacity-70' : 'text-muted-foreground')}`}>
                  <span>{time}</span>
                  {isEnd && status === 'sending' && (
                    <Loader2 className="w-3 h-3 animate-spin" aria-label="Sending" />
                  )}
                  {isEnd && status === 'failed' && (
                    <span title={failureReason ?? 'Send failed'} className="text-destructive">
                      <AlertCircle className="w-3 h-3" aria-label="Send failed" />
                    </span>
                  )}
                </span>
              </BubbleContent>

              {reactions && reactions.length > 0 && (
                <BubbleReactions side="bottom" align={isEnd ? "start" : "end"} className={isEnd ? "-translate-x-2" : "translate-x-2"}>
                  {reactions.map((r, i) => (
                    <button
                      key={`${r.emoji}:${i}`}
                      type="button"
                      onClick={() => handleReactClick(r.emoji)}
                      disabled={!canReact}
                      title={r.byBot ? "Tap to remove your reaction" : `React ${r.emoji}`}
                      className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 transition-colors ${
                        r.byBot
                          ? "bg-primary/25 ring-1 ring-primary/40"
                          : "hover:bg-black/5 dark:hover:bg-white/10"
                      } ${canReact ? "cursor-pointer" : "cursor-default"}`}
                    >
                      <span className="text-[11px] leading-none">{r.emoji}</span>
                      {(r.count ?? 0) > 0 && (
                        <span className="text-[10px] font-medium leading-none">{r.count}</span>
                      )}
                    </button>
                  ))}
                </BubbleReactions>
              )}
            </Bubble>

            {/* Keep the action row visible while the react picker is open.
                Without this, clicking Smile opens the popover, but the
                cursor may leave the message wrapper (e.g. moving to a
                popover emoji), `group-hover/msg` unsets, and the trigger
                fades from under the pointer mid-interaction. */}
            <div className={isEnd
              ? `absolute right-2 -bottom-2 z-10 flex items-center gap-1 transition-opacity ${reactPickerOpen ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'}`
              : `mb-2 flex items-center gap-1 transition-opacity ${reactPickerOpen ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'} ${reactions?.length ? 'mb-4' : ''}`}>
              {canReact && (
                <Popover open={reactPickerOpen} onOpenChange={setReactPickerOpen}>
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
                        onClick={() => handleReactClick(emoji)}
                        title={botEmoji === emoji ? "Remove your reaction" : `React ${emoji}`}
                        className={`text-lg hover:scale-125 transition-transform px-1 rounded-full ${
                          botEmoji === emoji ? "bg-primary/25 ring-1 ring-primary/40" : ""
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}

              {canReply && (
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
              )}
            </div>

          </div>
        }
      />

      <ContextMenuContent className="w-48">
        {canReact && (
          <div className="flex items-center gap-1 justify-between border-b border-border/50 mb-1 pb-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleReactClick(emoji)}
                title={botEmoji === emoji ? "Remove your reaction" : `React ${emoji}`}
                className={`text-lg hover:scale-125 transition-transform px-1 rounded-full ${
                  botEmoji === emoji ? "bg-primary/25 ring-1 ring-primary/40" : ""
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        {canReply && (
          <ContextMenuItem onClick={handleReplyClick}>
            <CornerUpLeft className="w-4 h-4" /> Reply
          </ContextMenuItem>
        )}
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
