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
 */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}
