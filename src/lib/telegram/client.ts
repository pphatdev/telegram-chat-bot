import type { TelegramApiResponse, TelegramMessage, TelegramUpdate, TelegramUser } from "./types";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
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

export interface SendMessageOptions {
  chat_id: number | string;
  text: string;
  parse_mode?: ParseMode;
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
  reply_to_message_id?: number;
  reply_markup?: InlineKeyboardMarkup;
}

export interface SendPhotoOptions {
  chat_id: number | string;
  photo: string; // file_id, URL, or reference to R2 object
  caption?: string;
  parse_mode?: ParseMode;
  disable_notification?: boolean;
  reply_to_message_id?: number;
  reply_markup?: InlineKeyboardMarkup;
}

export interface SendDocumentOptions {
  chat_id: number | string;
  document: string;
  caption?: string;
  parse_mode?: ParseMode;
  disable_notification?: boolean;
  reply_to_message_id?: number;
  reply_markup?: InlineKeyboardMarkup;
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

  constructor({ token, fetchImpl }: TelegramClientOptions) {
    if (!token) {
      throw new Error("TelegramClient: token is required");
    }
    this.token = token;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  private endpoint(method: string): string {
    return `${TELEGRAM_API_BASE}/bot${this.token}/${method}`;
  }

  private async call<T>(method: string, body?: object): Promise<T> {
    const res = await this.fetchImpl(this.endpoint(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await res.json()) as TelegramApiResponse<T>;
    if (!payload.ok || payload.result === undefined) {
      throw new TelegramApiError(
        method,
        payload.error_code ?? res.status,
        payload.description ?? "unknown",
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
  ) {
    super(`Telegram API ${method} failed: ${errorCode} ${description}`);
    this.name = "TelegramApiError";
  }
}
