/**
 * Runtime-validated types re-exported from `./schemas.ts`. Zod is the source
 * of truth — this file exists so consumers can `import type { ... } from
 * "@/lib/telegram/types"` without pulling the schema runtime.
 */

export type {
  TelegramCallbackQuery,
  TelegramChat,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./schemas";

/**
 * Envelope for direct Bot API HTTP responses (getMe, sendMessage, etc.).
 * Not part of the webhook payload surface, so lives outside the Zod tree.
 *
 * `parameters.retry_after` is populated on 429 (and some 5xx) responses to
 * hint how long the caller should back off before retrying. The dispatcher
 * uses it to schedule exponential-backoff retries on per-target broadcast
 * ledger rows.
 */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
}
