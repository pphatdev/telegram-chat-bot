"use client";

import { RefObject, useRef, useState } from "react";
import { toast } from "sonner";
import { X, Paperclip, Smile, Send, Loader2, Image as ImageIcon, File as FileIcon, MapPin, Contact, Star, PlaySquare, Search, Reply } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sendChatMessage } from "@/features/broadcast/actions";
import type { MessageRow } from "@telegram-bot/shared/db/schema";
import type { ReplyTarget } from "@/features/chats/components/chat-message";

interface ChatInputProps {
  activeChatId: number;
  replyTo: ReplyTarget | null;
  setReplyTo: (reply: ReplyTarget | null) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  activeEmojiTab: 'emoji' | 'sticker' | 'gif';
  setActiveEmojiTab: (tab: 'emoji' | 'sticker' | 'gif') => void;
  /** Append a message row. Called BOTH for the optimistic append (with a
   *  negative client-generated id and `status: 'sending'`) AND for the
   *  post-upload success append on the file path. Chat-shell doesn't
   *  differentiate — the row goes into state as-is. */
  onMessageSent?: (row: MessageRow) => void;
  /** Patch an already-appended row identified by its (possibly negative)
   *  client id. Used to (a) swap the negative id for the server-assigned
   *  one and mark it `sent` on success, or (b) mark it `failed` on error. */
  onMessageReconcile?: (clientId: number, patch: Partial<MessageRow>) => void;
}

const EMOJIS = [
  { char: '😀', name: 'grinning face happy smile' },
  { char: '😃', name: 'grinning face with big eyes' },
  { char: '😄', name: 'grinning face with smiling eyes' },
  { char: '😁', name: 'beaming face with smiling eyes' },
  { char: '😆', name: 'grinning squinting face laugh' },
  { char: '😅', name: 'grinning face with sweat' },
  { char: '😂', name: 'face with tears of joy laugh' },
  { char: '🤣', name: 'rolling on the floor laughing rofl' },
  { char: '😊', name: 'smiling face with smiling eyes' },
  { char: '😇', name: 'smiling face with halo angel' },
  { char: '🙂', name: 'slightly smiling face' },
  { char: '🙃', name: 'upside-down face' },
  { char: '😉', name: 'winking face' },
  { char: '😌', name: 'relieved face' },
  { char: '😍', name: 'smiling face with heart-eyes love' },
  { char: '🥰', name: 'smiling face with hearts love' },
  { char: '😘', name: 'face blowing a kiss love' },
  { char: '😋', name: 'face savoring food yummy' },
  { char: '😛', name: 'face with tongue' },
  { char: '😜', name: 'winking face with tongue' },
  { char: '🤪', name: 'zany face crazy' },
  { char: '😎', name: 'smiling face with sunglasses cool' },
  { char: '🤩', name: 'star-struck star eyes' },
  { char: '🥳', name: 'partying face celebrate' },
  { char: '😏', name: 'smirking face' },
  { char: '😒', name: 'unamused face' },
  { char: '😞', name: 'disappointed face sad' },
  { char: '😔', name: 'pensive face sad' },
  { char: '😟', name: 'worried face' },
  { char: '😕', name: 'confused face' },
  { char: '🙁', name: 'slightly frowning face' },
  { char: '☹️', name: 'frowning face sad' },
  { char: '😣', name: 'persevering face' },
  { char: '😖', name: 'confounded face' },
  { char: '😫', name: 'tired face' },
  { char: '😩', name: 'weary face' },
  { char: '🥺', name: 'pleading face puppy eyes' },
  { char: '😢', name: 'crying face sad' },
  { char: '😭', name: 'loudly crying face sad sob' },
  { char: '😤', name: 'face with steam from nose angry' },
  { char: '😠', name: 'angry face mad' },
  { char: '😡', name: 'pouting face red mad' },
  { char: '🤬', name: 'face with symbols on mouth swear' },
  { char: '🤯', name: 'exploding head mind blown' },
  { char: '😳', name: 'flushed face blush' },
  { char: '🥵', name: 'hot face sweating' },
  { char: '🥶', name: 'cold face freezing' },
  { char: '😱', name: 'face screaming in fear' },
  { char: '😨', name: 'fearful face' },
  { char: '😰', name: 'anxious face with sweat' },
  { char: '😥', name: 'sad but relieved face' },
  { char: '😓', name: 'downcast face with sweat' },
  { char: '🤔', name: 'thinking face' },
  { char: '🤭', name: 'face with hand over mouth oops' },
  { char: '🤫', name: 'shushing face quiet shh' },
  { char: '🤥', name: 'lying face pinocchio' },
  { char: '😶', name: 'face without mouth speechless' },
  { char: '😐', name: 'neutral face' },
  { char: '😑', name: 'expressionless face' },
  { char: '😬', name: 'grimacing face yikes' },
  { char: '🙄', name: 'face with rolling eyes' },
  { char: '😯', name: 'hushed face surprise' },
  { char: '😦', name: 'frowning face with open mouth' },
  { char: '😧', name: 'anguished face' },
  { char: '😮', name: 'face with open mouth surprise' },
  { char: '😲', name: 'astonished face wow' },
  { char: '🥱', name: 'yawning face tired' },
  { char: '😴', name: 'sleeping face zzz' },
  { char: '🤤', name: 'drooling face' },
  { char: '😪', name: 'sleepy face' },
  { char: '😵', name: 'dizzy face' },
  { char: '🤐', name: 'zipper-mouth face secret' },
  { char: '🥴', name: 'woozy face drunk' },
  { char: '🤢', name: 'nauseated face sick' },
  { char: '🤮', name: 'face vomiting sick' },
  { char: '🤧', name: 'sneezing face sick' },
  { char: '😷', name: 'face with medical mask sick' },
  { char: '🤒', name: 'face with thermometer sick' },
  { char: '🤕', name: 'face with head-bandage sick' },
  { char: '🤑', name: 'money-mouth face rich' },
  { char: '🤠', name: 'cowboy hat face' },
  { char: '😈', name: 'smiling face with horns devil' },
  { char: '👿', name: 'angry face with horns devil' },
  { char: '👹', name: 'ogre monster' },
  { char: '👺', name: 'goblin monster' },
  { char: '🤡', name: 'clown face' },
  { char: '💩', name: 'pile of poo poop' },
  { char: '👻', name: 'ghost' },
  { char: '💀', name: 'skull dead' },
  { char: '👽', name: 'alien' },
  { char: '👾', name: 'alien monster space invader' },
  { char: '🤖', name: 'robot' },
  { char: '🎃', name: 'jack-o-lantern pumpkin halloween' },
  { char: '😺', name: 'smiling cat face' },
  { char: '😸', name: 'grinning cat face with smiling eyes' },
  { char: '😹', name: 'cat face with tears of joy' },
  { char: '😻', name: 'smiling cat face with heart-eyes' },
  { char: '😼', name: 'cat face with wry smile' },
  { char: '😽', name: 'kissing cat face' },
  { char: '🙀', name: 'weary cat face' },
  { char: '😿', name: 'crying cat face' },
  { char: '😾', name: 'pouting cat face' },
];

const STICKERS: { src?: string; name: string; char?: string }[] = [
  { src: "/stickers/pphat/0.webm", name: "pphat 😡 mad angry" },
  { src: "/stickers/pphat/1.webm", name: "pphat 😟 sad" },
  { src: "/stickers/pphat/2.webm", name: "pphat 😘 kiss love" },
  { src: "/stickers/pphat/3.webm", name: "pphat 😕 confused" },
  { src: "/stickers/pphat/4.webm", name: "pphat ☺️ blush smile" },
  { src: "/stickers/pphat/5.webm", name: "pphat 😉 wink" },
  { src: "/stickers/pphat/6.webm", name: "pphat 🤗 hug" },
  { src: "/stickers/pphat/7.webm", name: "pphat 👌 ok perfect" },
  { src: "/stickers/pphat/8.webm", name: "pphat 🌈 rainbow" },
  { src: "/stickers/pphat/9.webm", name: "pphat ❤️ heart love" },
  { src: "/stickers/pphat/10.webm", name: "pphat 😩 tired" },
  { src: "/stickers/pphat/11.webm", name: "pphat 😭 cry tears" },
  { src: "/stickers/pphat/12.webm", name: "pphat 🙂‍↕️ nod yes" },
  { src: "/stickers/pphat/13.webm", name: "pphat 😊 happy" },
  { src: "/stickers/pphat/14.webm", name: "pphat 🤤 drool" },
  { src: "/stickers/pphat/15.webm", name: "pphat 🤔 think" },
  { src: "/stickers/pphat/16.webm", name: "pphat 🤨 suspicious" },
  { src: "/stickers/pphat/17.webm", name: "pphat 🤯 mind blown wow" },
  { src: "/stickers/pphat/18.webm", name: "pphat 🫡 salute" },
  { src: "/stickers/pphat/19.webm", name: "pphat 🫥 invisible hide" },
  { src: "/stickers/pphat/20.webm", name: "pphat 🫩 stop" },
  { src: "/stickers/pphat/21.webm", name: "pphat 👍 thumbs up" },
  { src: "/stickers/pphat/22.webm", name: "pphat 😂 laugh joy" },
  { src: "/stickers/pphat/23.webm", name: "pphat 🥳 party celebrate" }
];

const GIFS = [
  { id: 1, name: 'funny cat laugh' },
  { id: 2, name: 'dog dance happy' },
  { id: 3, name: 'crying sad tears' },
  { id: 4, name: 'mind blown wow' },
  { id: 5, name: 'applause clap' },
  { id: 6, name: 'angry mad rage' },
  { id: 7, name: 'party celebrate' },
  { id: 8, name: 'hello wave hi' },
  { id: 9, name: 'goodbye wave bye' },
  { id: 10, name: 'yes nod agree' },
  { id: 11, name: 'no head shake deny' },
  { id: 12, name: 'hug love' },
];

export function ChatInput({
  activeChatId,
  replyTo,
  setReplyTo,
  inputRef,
  activeEmojiTab,
  setActiveEmojiTab,
  onMessageSent,
  onMessageReconcile,
}: ChatInputProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachKind, setAttachKind] = useState<"photo" | "document" | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  /**
   * Synchronous double-submit guard. `isSending` is React state and lags
   * one render behind — two Enter events in the same tick both see the
   * stale `false` and fire two server calls. A ref is checked/written
   * synchronously so the second press is a hard no-op.
   *
   * Applies to both text send and file upload paths; each grabs the lock
   * on entry and releases in `finally`.
   */
  const sendInFlightRef = useRef(false);

  const canSend = draft.trim().length > 0 && !isSending;

  const openFilePicker = (kind: "photo" | "document") => {
    setAttachKind(kind);
    // Set the input's accept attr via a data-attr React can't drive natively
    // — we mutate the DOM element right before opening the OS picker.
    const el = attachInputRef.current;
    if (!el) return;
    el.value = "";
    el.accept = kind === "photo" ? "image/*" : "*/*";
    el.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !attachKind) return;
    // Sync guard — the file picker itself is a modal-ish flow so double-fire
    // is less likely than for Enter, but the same lock applies uniformly.
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setIsSending(true);
    const toastId = toast.loading(`Uploading ${file.name}...`);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", attachKind);
      const uploadRes = await fetch("/api/media/upload", { method: "POST", body: form });
      const uploaded = (await uploadRes.json()) as
        | { ok: true; r2Key: string; mimeType: string; size: number; kind: "photo" | "video" | "audio" | "document" }
        | { ok: false; error: string; description?: string };
      if (!uploaded.ok) {
        toast.error(uploaded.description ?? uploaded.error, { id: toastId });
        return;
      }

      const caption = draft.trim() || undefined;
      const replyToMessageId = replyTo?.telegramMessageId;
      const payload =
        attachKind === "photo"
          ? { kind: "photo" as const, mediaR2Key: uploaded.r2Key, caption, replyToMessageId }
          : { kind: "document" as const, mediaR2Key: uploaded.r2Key, caption, replyToMessageId };

      const send = await sendChatMessage(activeChatId, payload);
      if (!send.ok) {
        toast.error(send.error, { id: toastId });
        return;
      }

      toast.success(`Sent ${attachKind}`, { id: toastId });
      setDraft("");
      onMessageSent?.({
        id: send.messageId,
        botId: 0,
        chatId: activeChatId,
        telegramMessageId: send.telegramMessageId,
        direction: "out",
        kind: attachKind,
        authorName: null,
        authorTelegramId: null,
        text: caption ?? null,
        replyToMessageId: replyToMessageId ?? null,
        mediaR2Key: uploaded.r2Key,
        mediaMimeType: uploaded.mimeType,
        reactionsJson: null,
        status: "sent",
        failureReason: null,
        sentAt: Math.floor(Date.now() / 1000),
        createdAt: Math.floor(Date.now() / 1000),
      });
    } finally {
      setIsSending(false);
      setAttachKind(null);
      sendInFlightRef.current = false;
    }
  };

  /**
   * Send a text message. Best-practice send flow:
   *
   *   1. **Sync guard** via `sendInFlightRef` — blocks double-submit from a
   *      fast Enter-Enter before React re-renders `isSending`.
   *   2. **Snapshot** draft + reply target so later `setDraft("")` /
   *      `setReplyTo(null)` don't affect the in-flight request.
   *   3. **Clear the composer immediately** so the user can start typing
   *      the next message while this one is in flight (Telegram / iMessage
   *      style — the perceived latency is zero).
   *   4. **Optimistic append** with a negative client id and
   *      `status: 'sending'` so the bubble shows up instantly.
   *   5. **Reconcile** on success — swap the negative id for the server
   *      one and mark `sent`. **Rollback** on failure — mark the row
   *      `failed` and restore the draft so the user can edit and retry.
   *
   * Multiple distinct sends are allowed concurrently (they don't collide —
   * each has its own client id); only the *same* click/Enter is deduped.
   */
  const handleSend = async () => {
    if (sendInFlightRef.current) return;
    const text = draft.trim();
    if (!text) return;
    sendInFlightRef.current = true;

    const replyToMessageId = replyTo?.telegramMessageId ?? null;
    const nowSec = Math.floor(Date.now() / 1000);
    // Negative id guarantees no collision with server-assigned ids (all
    // positive autoincrements in D1). Include a random suffix so two
    // sends in the same second still get unique ids.
    const clientId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

    // 1. Clear composer immediately — snappy UX.
    setDraft("");
    setReplyTo(null);
    inputRef.current?.focus();
    setIsSending(true);

    // 2. Optimistic append with a "sending" status.
    onMessageSent?.({
      id: clientId,
      botId: 0,
      chatId: activeChatId,
      telegramMessageId: null,
      direction: "out",
      kind: "text",
      authorName: null,
      authorTelegramId: null,
      text,
      replyToMessageId,
      mediaR2Key: null,
      mediaMimeType: null,
      reactionsJson: null,
      status: "sending",
      failureReason: null,
      sentAt: nowSec,
      createdAt: nowSec,
    });

    try {
      const result = await sendChatMessage(activeChatId, {
        kind: "text",
        text,
        replyToMessageId: replyToMessageId ?? undefined,
      });
      if (result.ok) {
        // 3a. Reconcile: replace negative id + null telegramMessageId with
        //     the real server-assigned ones so replies / reactions can
        //     target this message. If the server dropped the reply (parent
        //     was deleted from Telegram), also clear the optimistic
        //     `replyToMessageId` so the bubble stops rendering the reply chip.
        onMessageReconcile?.(clientId, {
          id: result.messageId,
          telegramMessageId: result.telegramMessageId,
          status: "sent",
          ...(result.replyDropped && { replyToMessageId: null }),
        });
        if (result.replyDropped) {
          toast("The original message was deleted — sent as a regular message.");
        }
      } else {
        // 3b. Rollback: mark the optimistic row failed and put the text
        //     back in the draft so the user can retry / edit.
        onMessageReconcile?.(clientId, {
          status: "failed",
          failureReason: result.error,
        });
        setDraft((current) => current === "" ? text : current);
        if (result.code === "rate_limited" && result.retryAfterMs) {
          toast.error(`${result.error}. Retry in ${Math.ceil(result.retryAfterMs / 1000)}s.`);
        } else {
          toast.error(result.error);
        }
      }
    } catch (err) {
      // Network error — same rollback path as a structured failure.
      const message = err instanceof Error ? err.message : "Send failed";
      onMessageReconcile?.(clientId, { status: "failed", failureReason: message });
      setDraft((current) => current === "" ? text : current);
      toast.error(message);
    } finally {
      setIsSending(false);
      sendInFlightRef.current = false;
    }
  };

  /**
   * Send one of the composer's built-in stickers. Same sync-guard +
   * optimistic-append-with-reconcile flow as `handleSend`.
   *
   * `stickerRef` on the wire must be a URL Telegram can fetch — so we
   * resolve the picker's `sticker.src` (a leading-slash path like
   * `/stickers/pphat/0.webm`) against `window.location.origin`. Locally
   * we use the same absolute URL for the optimistic preview so the video
   * starts playing immediately without waiting for the server round-trip.
   */
  const handleSendSticker = async (src: string) => {
    if (sendInFlightRef.current) return;
    if (!src) return;
    sendInFlightRef.current = true;

    const absoluteUrl = new URL(src, window.location.origin).toString();
    const mime = src.toLowerCase().endsWith(".webm") ? "video/webm" : "image/webp";
    const nowSec = Math.floor(Date.now() / 1000);
    const clientId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
    const replyToMessageId = replyTo?.telegramMessageId ?? null;

    setReplyTo(null);
    setIsSending(true);

    onMessageSent?.({
      id: clientId,
      botId: 0,
      chatId: activeChatId,
      telegramMessageId: null,
      direction: "out",
      kind: "sticker",
      authorName: null,
      authorTelegramId: null,
      text: null,
      replyToMessageId,
      mediaR2Key: absoluteUrl,
      mediaMimeType: mime,
      reactionsJson: null,
      status: "sending",
      failureReason: null,
      sentAt: nowSec,
      createdAt: nowSec,
    });

    try {
      const result = await sendChatMessage(activeChatId, {
        kind: "sticker",
        stickerRef: absoluteUrl,
      });
      if (result.ok) {
        onMessageReconcile?.(clientId, {
          id: result.messageId,
          telegramMessageId: result.telegramMessageId,
          status: "sent",
        });
      } else {
        onMessageReconcile?.(clientId, {
          status: "failed",
          failureReason: result.error,
        });
        if (result.code === "rate_limited" && result.retryAfterMs) {
          toast.error(`${result.error}. Retry in ${Math.ceil(result.retryAfterMs / 1000)}s.`);
        } else {
          toast.error(result.error);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      onMessageReconcile?.(clientId, { status: "failed", failureReason: message });
      toast.error(message);
    } finally {
      setIsSending(false);
      sendInFlightRef.current = false;
    }
  };

  const filteredEmojis = EMOJIS.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredStickers = STICKERS.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredGifs = GIFS.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // Reset search when switching tabs
  const handleTabChange = (tab: 'emoji' | 'sticker' | 'gif') => {
    setActiveEmojiTab(tab);
    setSearchQuery("");
  };

  return (
    <div className="relative mx-auto w-full max-w-4xl px-3 pb-4 sm:px-8">
      {replyTo && (
        <div className="absolute inset-x-3 bottom-[calc(100%-16px)] sm:inset-x-8 z-0 flex items-center gap-2 rounded-t-4xl bg-card/80 px-3 pb-5 pt-2.5 shadow-sm backdrop-blur-xl border-t border-x border-border animate-in fade-in slide-in-from-bottom-6 duration-200 ease-out">
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <Reply className="w-3.5 h-3.5" />
          </div>
          <div className="w-1 rounded-full bg-primary self-stretch my-0.5" />
          <div className="flex-1 min-w-0 pl-1 pr-2 py-0.5 leading-tight">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70">Replying to</span>
              <span className="text-[13px] font-semibold text-primary truncate">{replyTo.author}</span>
            </div>
            <div className="text-muted-foreground truncate text-xs mt-0.5">{replyTo.text}</div>
          </div>
          <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)} className="relative z-50 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 relative z-10 rounded-[28px] bg-background/70 backdrop-blur-3xl px-3 py-2 border border-black/10 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.12),0_1px_1px_rgba(255,255,255,0.15)_inset]">
        <div className="pb-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Attach file"
              className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Paperclip className="w-5 h-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-48 rounded-[20px] bg-background/95 backdrop-blur-3xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.2),0_2px_12px_rgba(255,255,255,0.2)_inset] p-1.5"
            >
              <DropdownMenuItem className="font-medium" onClick={() => openFilePicker("photo")}>
                <ImageIcon className="text-sky-500" /> Photo
              </DropdownMenuItem>
              <DropdownMenuItem className="font-medium" onClick={() => openFilePicker("document")}>
                <FileIcon className="text-emerald-500" /> Document
              </DropdownMenuItem>
              <DropdownMenuItem className="font-medium" disabled>
                <MapPin className="text-rose-500" /> Location
              </DropdownMenuItem>
              <DropdownMenuItem className="font-medium" disabled>
                <Contact className="text-amber-500" /> Contact
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={attachInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelected}
            aria-hidden="true"
          />
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          placeholder="Write a message..."
          aria-label="Write a message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground field-sizing-content scrollbar-none [&::-webkit-scrollbar]:hidden"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setReplyTo(null);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <div className="pb-1">
          <Popover>
            <PopoverTrigger
              aria-label="Add emoji"
              className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Smile className="w-5 h-5" />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              sideOffset={8}
              className="p-0 w-80 h-80 rounded-[24px] bg-background/70 backdrop-blur-3xl shadow-[0_10px_40px_rgba(0,0,0,0.2),0_2px_12px_rgba(255,255,255,0.2)_inset] border border-white/10 flex flex-col overflow-hidden gap-0"
            >
              <Tabs
                value={activeEmojiTab}
                onValueChange={(v) => handleTabChange(v as 'emoji' | 'sticker' | 'gif')}
                className="flex flex-col flex-1 min-h-0 gap-0"
              >
                {/* Search Bar */}
                <div className="px-2 pt-2 pb-1 border-b border-white/5">
                  <div className="flex items-center gap-2 rounded-[16px] bg-black/10 dark:bg-white/10 px-2 py-1.5 text-sm focus-within:bg-black/20 dark:focus-within:bg-white/20 focus-within:ring-2 focus-within:ring-primary/30 border border-white/5 shadow-[0_1px_5px_rgba(0,0,0,0.1)_inset]">
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={`Search ${activeEmojiTab}s...`}
                      className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 min-h-0">
                  <TabsContent value="emoji" className="grid grid-cols-8 gap-1">
                    {filteredEmojis.map((emoji, i) => (
                      <button key={i} title={emoji.name} className="text-xl hover:bg-accent rounded-md p-1 transition-colors text-center">
                        {emoji.char}
                      </button>
                    ))}
                    {filteredEmojis.length === 0 && (
                      <div className="col-span-8 text-center py-8 text-sm text-muted-foreground">No emojis found.</div>
                    )}
                  </TabsContent>
                  <TabsContent value="sticker" className="grid grid-cols-4 gap-3">
                    {filteredStickers.map((sticker, i) => (
                      <button
                        key={i}
                        type="button"
                        title={sticker.name}
                        onClick={() => sticker.src && handleSendSticker(sticker.src)}
                        disabled={!sticker.src || isSending}
                        className="aspect-square bg-accent/30 rounded-xl hover:bg-accent transition-colors flex items-center justify-center text-4xl overflow-hidden p-1 relative disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                      >
                        {sticker.src ? (
                          sticker.src.endsWith('.webm') ? (
                            <video src={sticker.src} autoPlay loop muted playsInline className="w-full h-full object-contain pointer-events-none" />
                          ) : (
                            <img src={sticker.src} alt={sticker.name} className="w-full h-full object-contain pointer-events-none" />
                          )
                        ) : (
                          sticker.char
                        )}
                      </button>
                    ))}
                    {filteredStickers.length === 0 && (
                      <div className="col-span-4 text-center py-8 text-sm text-muted-foreground">No stickers found.</div>
                    )}
                  </TabsContent>
                  <TabsContent value="gif" className="grid grid-cols-2 gap-2">
                    {filteredGifs.map((gif) => (
                      <button key={gif.id} className="aspect-video bg-accent/40 rounded-lg hover:bg-accent transition-colors flex items-center justify-center relative overflow-hidden group">
                        <div className="absolute inset-0 bg-linear-to-br from-indigo-500/20 to-purple-500/20" />
                        <PlaySquare className="w-8 h-8 text-foreground/30 group-hover:text-foreground/60 transition-colors z-10" />
                        <span className="absolute bottom-1 left-2 text-[10px] font-bold text-foreground/50 z-10">{gif.name}</span>
                      </button>
                    ))}
                    {filteredGifs.length === 0 && (
                      <div className="col-span-2 text-center py-8 text-sm text-muted-foreground">No GIFs found.</div>
                    )}
                  </TabsContent>
                </div>

                <TabsList
                  variant="line"
                  className="w-full h-auto rounded-none p-2 gap-1 bg-background/40 backdrop-blur-md border-t border-white/5"
                >
                  <TabsTrigger
                    value="emoji"
                    className="flex-1 rounded-full py-1.5 text-sm font-medium data-active:bg-accent data-active:text-accent-foreground data-active:after:opacity-0 border-0"
                  >
                    <Smile className="w-4 h-4" /> Emoji
                  </TabsTrigger>
                  <TabsTrigger
                    value="sticker"
                    className="flex-1 rounded-full py-1.5 text-sm font-medium data-active:bg-accent data-active:text-accent-foreground data-active:after:opacity-0 border-0"
                  >
                    <Star className="w-4 h-4" /> Stickers
                  </TabsTrigger>
                  <TabsTrigger
                    value="gif"
                    className="flex-1 rounded-full py-1.5 text-sm font-medium data-active:bg-accent data-active:text-accent-foreground data-active:after:opacity-0 border-0"
                  >
                    <PlaySquare className="w-4 h-4" /> GIFs
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </PopoverContent>
          </Popover>
        </div>
        <Tooltip>
          <TooltipTrigger
            aria-label="Send message"
            disabled={!canSend}
            onClick={handleSend}
            className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
          </TooltipTrigger>
          <TooltipContent side="top">Send</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
