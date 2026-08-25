import type { TelegramApiResponse, TelegramMessage, TelegramUpdate, TelegramUser } from "./types";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramClientOptions {
    token: string;
    fetchImpl?: typeof fetch;
    /**
     * When true, every call() logs method + request body + response to the
     * Worker's stdout. Token is NEVER logged (we only ever log the method
     * name, not the URL). Gated per-user via `users.debug_enabled` — callers
     * pass that flag through when constructing.
     */
    debug?: boolean;
    /**
     * Human label included in every debug log line. Typically
     * `bot:<botId>` or `bot:<botId>:<username>` so multi-bot streams stay
     * disambiguated when tailing the Worker.
     */
    debugLabel?: string;
}

export type ParseMode = "MarkdownV2" | "HTML" | "Markdown";

export interface InlineKeyboardButton {
    text: string;
    url?: string;
    callback_data?: string;
}

export interface InlineKeyboardMarkup {
    inline_keyboard: InlineKeyboardButton[][];
}

interface SendCommonOptions {
    chat_id: number | string;
    parse_mode?: ParseMode;
    disable_notification?: boolean;
    reply_to_message_id?: number;
    reply_markup?: InlineKeyboardMarkup;
}

export interface SendMessageOptions extends SendCommonOptions {
    text: string;
    disable_web_page_preview?: boolean;
}

export interface SendPhotoOptions extends SendCommonOptions {
    photo: string; // file_id, URL, or reference to R2 object
    caption?: string;
}

export interface SendDocumentOptions extends SendCommonOptions {
    document: string;
    caption?: string;
}

export interface SendVideoOptions extends SendCommonOptions {
    video: string;
    caption?: string;
    duration?: number;
    width?: number;
    height?: number;
    supports_streaming?: boolean;
}

export interface SendAudioOptions extends SendCommonOptions {
    audio: string;
    caption?: string;
    duration?: number;
    performer?: string;
    title?: string;
}

export interface SendStickerOptions extends SendCommonOptions {
    sticker: string;
    emoji?: string;
}

export interface EditMessageTextOptions {
    chat_id: number | string;
    message_id: number;
    text: string;
    parse_mode?: ParseMode;
    disable_web_page_preview?: boolean;
    reply_markup?: InlineKeyboardMarkup;
}

export interface DeleteMessageOptions {
    chat_id: number | string;
    message_id: number;
}

/**
 * https://core.telegram.org/bots/api#reactiontype
 * Bots may only set `emoji` reactions (custom_emoji is user-only). Passing
 * an empty array to setMessageReaction removes the bot's current reaction.
 */
export type ReactionType = { type: "emoji"; emoji: string };

export interface SetMessageReactionOptions {
    chat_id: number | string;
    message_id: number;
    /** Zero or one entries — Bot API caps bots at a single reaction per message. */
    reaction?: ReactionType[];
    /** Show the "big" animation on the receiver's screen. */
    is_big?: boolean;
}

/**
 * Chat-action values Telegram accepts on `sendChatAction`. Kept as a string
 * literal so consumers can pass any future action without a client update,
 * but the common ones are documented as the primary use-cases.
 */
export type ChatAction =
    | "typing"
    | "upload_photo"
    | "record_video"
    | "upload_video"
    | "record_voice"
    | "upload_voice"
    | "upload_document"
    | "choose_sticker"
    | "find_location"
    | "record_video_note"
    | "upload_video_note";

export interface SendChatActionOptions {
    chat_id: number | string;
    action: ChatAction;
}

export interface GetUpdatesOptions {
    offset?: number;
    limit?: number;
    timeout?: number;
    allowed_updates?: string[];
}

export interface SetWebhookOptions {
    url: string;
    secret_token?: string;
    allowed_updates?: string[];
    drop_pending_updates?: boolean;
}

export interface AnswerCallbackQueryOptions {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
}

/**
 * https://core.telegram.org/bots/api#webhookinfo
 * Only the fields the debug panel renders are typed explicitly; the raw
 * response is passed through so future Bot API additions surface unchanged.
 */
export interface WebhookInfo {
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    ip_address?: string;
    last_error_date?: number;
    last_error_message?: string;
    last_synchronization_error_date?: number;
    max_connections?: number;
    allowed_updates?: string[];
}

/** https://core.telegram.org/bots/api#chatphoto — only file ids we use. */
export interface TelegramChatPhoto {
    small_file_id: string;
    small_file_unique_id: string;
    big_file_id: string;
    big_file_unique_id: string;
}

/**
 * Minimal `ChatFullInfo` — only the fields the avatar pipeline reads. The
 * full response also carries description, permissions, member count, etc.
 * — passthrough at the runtime level, we just don't type them here.
 */
export interface ChatFullInfo {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    photo?: TelegramChatPhoto;
    bio?: string;
    description?: string;
}

/** https://core.telegram.org/bots/api#file */
export interface TelegramFile {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    /** Relative path suitable for `https://api.telegram.org/file/bot<TOKEN>/<file_path>`. */
    file_path?: string;
}

/** https://core.telegram.org/bots/api#userprofilephotos */
export interface UserProfilePhotos {
    total_count: number;
    /** Each element is an array of `PhotoSize` (thumbnail → original). */
    photos: Array<Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>>;
}

/**
 * Typed wrapper around the Telegram Bot HTTP API.
 *
 * Every method is a thin async passthrough to `/bot<TOKEN>/<method>` — no
 * retry, no rate-limiting, no logging. Those cross-cutting concerns live in
 * the broadcast dispatcher (`src/features/broadcast/`) which composes this
 * client with `src/lib/rate-limit/telegram.ts` and the allowlist guards.
 *
 * Runs on the Cloudflare Workers runtime — no Node-only APIs.
 */
export class TelegramClient {
    private readonly token: string;
    private readonly fetchImpl: typeof fetch;
    private readonly debug: boolean;
    private readonly debugLabel: string;

    constructor({ token, fetchImpl, debug, debugLabel }: TelegramClientOptions) {
        if (!token) {
            throw new Error("TelegramClient: token is required");
        }
        this.token = token;
        this.fetchImpl = fetchImpl ?? fetch;
        this.debug = debug ?? false;
        this.debugLabel = debugLabel ?? "bot:unknown";
    }

    private endpoint(method: string): string {
        return `${TELEGRAM_API_BASE}/bot${this.token}/${method}`;
    }

    private async call<T>(method: string, body?: object): Promise<T> {
        if (this.debug) {
            console.log(
                `[tg:debug] ${this.debugLabel} → ${method}`,
                body ? JSON.stringify(body) : "(no body)",
            );
        }
        const started = this.debug ? Date.now() : 0;

        let res: Response;
        try {
            res = await this.fetchImpl(this.endpoint(method), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (err) {
            // Node/undici throws `TypeError: fetch failed` for DNS, refused
            // connections, IPv6 mishaps, or certificate errors. In workerd
            // the message is similar. Either way we never got a response,
            // so callers need a distinct error type from Telegram-side 4xx/5xx.
            const cause = err instanceof Error ? err.message : String(err);
            if (this.debug) {
                console.error(`[tg:debug] ${this.debugLabel} × ${method} network:`, cause);
            }
            throw new TelegramNetworkError(method, cause);
        }

        let payload: TelegramApiResponse<T>;
        try {
            payload = (await res.json()) as TelegramApiResponse<T>;
        } catch (err) {
            const cause = err instanceof Error ? err.message : String(err);
            if (this.debug) {
                console.error(`[tg:debug] ${this.debugLabel} × ${method} bad_response:`, cause);
            }
            throw new TelegramNetworkError(method, `invalid JSON from ${res.status}: ${cause}`);
        }

        if (this.debug) {
            const elapsed = Date.now() - started;
            console.log(
                `[tg:debug] ${this.debugLabel} ← ${method} (${res.status} ${elapsed}ms)`,
                JSON.stringify(payload),
            );
        }
        if (!payload.ok || payload.result === undefined) {
            throw new TelegramApiError(
                method,
                payload.error_code ?? res.status,
                payload.description ?? "unknown",
                payload.parameters?.retry_after,
            );
        }
        return payload.result;
    }

    /** https://core.telegram.org/bots/api#getme */
    getMe(): Promise<TelegramUser> {
        return this.call<TelegramUser>("getMe");
    }

    /** https://core.telegram.org/bots/api#sendmessage */
    sendMessage(opts: SendMessageOptions): Promise<TelegramMessage> {
        return this.call<TelegramMessage>("sendMessage", opts);
    }

    /** https://core.telegram.org/bots/api#sendphoto */
    sendPhoto(opts: SendPhotoOptions): Promise<TelegramMessage> {
        return this.call<TelegramMessage>("sendPhoto", opts);
    }

    /** https://core.telegram.org/bots/api#senddocument */
    sendDocument(opts: SendDocumentOptions): Promise<TelegramMessage> {
        return this.call<TelegramMessage>("sendDocument", opts);
    }

    /** https://core.telegram.org/bots/api#sendvideo */
    sendVideo(opts: SendVideoOptions): Promise<TelegramMessage> {
        return this.call<TelegramMessage>("sendVideo", opts);
    }

    /** https://core.telegram.org/bots/api#sendaudio */
    sendAudio(opts: SendAudioOptions): Promise<TelegramMessage> {
        return this.call<TelegramMessage>("sendAudio", opts);
    }

    /** https://core.telegram.org/bots/api#sendsticker */
    sendSticker(opts: SendStickerOptions): Promise<TelegramMessage> {
        return this.call<TelegramMessage>("sendSticker", opts);
    }

    /** https://core.telegram.org/bots/api#editmessagetext */
    editMessageText(opts: EditMessageTextOptions): Promise<TelegramMessage | boolean> {
        return this.call<TelegramMessage | boolean>("editMessageText", opts);
    }

    /** https://core.telegram.org/bots/api#deletemessage */
    deleteMessage(opts: DeleteMessageOptions): Promise<boolean> {
        return this.call<boolean>("deleteMessage", opts);
    }

    /**
     * https://core.telegram.org/bots/api#setmessagereaction
     * Set or clear the bot's reaction to a message. Pass an empty
     * `reaction` array (or omit it) to remove any existing reaction.
     */
    setMessageReaction(opts: SetMessageReactionOptions): Promise<boolean> {
        return this.call<boolean>("setMessageReaction", opts);
    }

    /** https://core.telegram.org/bots/api#sendchataction */
    sendChatAction(opts: SendChatActionOptions): Promise<boolean> {
        return this.call<boolean>("sendChatAction", opts);
    }

    /** https://core.telegram.org/bots/api#getupdates */
    getUpdates(opts: GetUpdatesOptions = {}): Promise<TelegramUpdate[]> {
        return this.call<TelegramUpdate[]>("getUpdates", opts);
    }

    /** https://core.telegram.org/bots/api#setwebhook */
    setWebhook(opts: SetWebhookOptions): Promise<boolean> {
        return this.call<boolean>("setWebhook", opts);
    }

    /** https://core.telegram.org/bots/api#deletewebhook */
    deleteWebhook(dropPending = false): Promise<boolean> {
        return this.call<boolean>("deleteWebhook", { drop_pending_updates: dropPending });
    }

    /** https://core.telegram.org/bots/api#getwebhookinfo */
    getWebhookInfo(): Promise<WebhookInfo> {
        return this.call<WebhookInfo>("getWebhookInfo");
    }

    /** https://core.telegram.org/bots/api#getchat */
    getChat(chatId: number | string): Promise<ChatFullInfo> {
        return this.call<ChatFullInfo>("getChat", { chat_id: chatId });
    }

    /** https://core.telegram.org/bots/api#getfile — resolves a file_id to a downloadable file_path. */
    getFile(fileId: string): Promise<TelegramFile> {
        return this.call<TelegramFile>("getFile", { file_id: fileId });
    }

    /**
     * https://core.telegram.org/bots/api#getuserprofilephotos
     * Fetch a user's public profile photos. Used by the per-user avatar
     * proxy to seed R2 with the smallest available thumbnail.
     */
    getUserProfilePhotos(
        userId: number,
        opts: { offset?: number; limit?: number } = {},
    ): Promise<UserProfilePhotos> {
        return this.call<UserProfilePhotos>("getUserProfilePhotos", { user_id: userId, ...opts });
    }

    /**
     * Download a file previously resolved via {@link getFile}. This is the
     * ONE Bot API call that doesn't go through /bot<TOKEN>/<method> — it
     * hits /file/bot<TOKEN>/<file_path> and returns raw bytes.
     *
     * Returned as a `Response` so callers can pipe it directly to R2's
     * `put()` without materializing a Buffer in Worker memory.
     */
    async downloadFile(filePath: string): Promise<Response> {
        const url = `${TELEGRAM_API_BASE}/file/bot${this.token}/${filePath}`;
        if (this.debug) console.log(`[tg:debug] ${this.debugLabel} → downloadFile ${filePath}`);
        const started = this.debug ? Date.now() : 0;
        let res: Response;
        try {
            res = await this.fetchImpl(url);
        } catch (err) {
            const cause = err instanceof Error ? err.message : String(err);
            if (this.debug) console.error(`[tg:debug] ${this.debugLabel} × downloadFile network:`, cause);
            throw new TelegramNetworkError("downloadFile", cause);
        }
        if (this.debug) {
            console.log(`[tg:debug] ${this.debugLabel} ← downloadFile (${res.status} ${Date.now() - started}ms)`);
        }
        if (!res.ok) {
            throw new TelegramApiError("downloadFile", res.status, res.statusText || "download failed");
        }
        return res;
    }

    /** https://core.telegram.org/bots/api#answercallbackquery */
    answerCallbackQuery(opts: AnswerCallbackQueryOptions): Promise<boolean> {
        return this.call<boolean>("answerCallbackQuery", opts);
    }
}

export class TelegramApiError extends Error {
    constructor(
        public readonly method: string,
        public readonly errorCode: number,
        public readonly description: string,
        /**
         * Populated when Telegram returns 429 or 5xx with `parameters.retry_after`
         * — the number of seconds the caller must wait before retrying.
         */
        public readonly retryAfterSeconds?: number,
    ) {
        super(`Telegram API ${method} failed: ${errorCode} ${description}`);
        this.name = "TelegramApiError";
    }

    /**
     * True when the error is safe to retry after a backoff — network hiccups,
     * Telegram-side 5xx, or explicit 429 rate-limits. Callers must NOT retry
     * on 4xx other than 429 (those are permanent — bad token, blocked, etc.).
     */
    get isRetryable(): boolean {
        if (this.errorCode === 429) return true;
        if (this.errorCode >= 500 && this.errorCode < 600) return true;
        return false;
    }
}

/**
 * Thrown when the HTTP fetch itself fails — DNS failure, connection refused,
 * TLS issue, IPv6 misroute, corporate proxy blocking `api.telegram.org`,
 * etc. Distinct from `TelegramApiError` (which means Telegram DID respond,
 * just with an error status).
 *
 * Always retryable in principle: the request never reached Telegram, so
 * the operator's dispatch/idempotency assumptions still hold.
 */
export class TelegramNetworkError extends Error {
    readonly isRetryable = true;
    constructor(
        public readonly method: string,
        public readonly cause: string,
    ) {
        super(`Telegram API ${method}: network error (${cause})`);
        this.name = "TelegramNetworkError";
    }
}
