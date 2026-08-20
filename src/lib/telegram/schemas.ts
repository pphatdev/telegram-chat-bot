import { z } from "zod";

/**
 * Runtime Zod schemas for inbound Telegram Bot API payloads.
 *
 * These are the source of truth for `types.ts` — hand-maintained interfaces
 * that ship in the client-facing bundle stay in sync via `z.infer`. Every
 * schema is `.passthrough()` so unknown fields introduced by Telegram
 * flow through unchanged instead of being stripped.
 *
 * Only the subset consumed by the current milestone is modeled; extend
 * incrementally rather than trying to mirror the full Bot API surface.
 */

export const telegramUserSchema = z
  .object({
    id: z.number().int(),
    is_bot: z.boolean(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    language_code: z.string().optional(),
  })
  .passthrough();

export const telegramChatSchema = z
  .object({
    id: z.number().int(),
    type: z.enum(["private", "group", "supergroup", "channel"]),
    title: z.string().optional(),
    username: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })
  .passthrough();

// `TelegramMessage` is recursive (reply_to_message → TelegramMessage), so we
// define it with z.lazy and the explicit type ascription Zod requires.
export type TelegramMessageInput = {
  message_id: number;
  from?: z.infer<typeof telegramUserSchema>;
  chat: z.infer<typeof telegramChatSchema>;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessageInput;
  [key: string]: unknown;
};

export const telegramMessageSchema: z.ZodType<TelegramMessageInput> = z.lazy(
  () =>
    z
      .object({
        message_id: z.number().int(),
        from: telegramUserSchema.optional(),
        chat: telegramChatSchema,
        date: z.number().int(),
        text: z.string().optional(),
        caption: z.string().optional(),
        reply_to_message: telegramMessageSchema.optional(),
      })
      .passthrough(),
);

export const telegramCallbackQuerySchema = z
  .object({
    id: z.string(),
    from: telegramUserSchema,
    data: z.string().optional(),
    message: telegramMessageSchema.optional(),
  })
  .passthrough();

export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: telegramMessageSchema.optional(),
    edited_message: telegramMessageSchema.optional(),
    channel_post: telegramMessageSchema.optional(),
    callback_query: telegramCallbackQuerySchema.optional(),
  })
  .passthrough();

export type TelegramUser = z.infer<typeof telegramUserSchema>;
export type TelegramChat = z.infer<typeof telegramChatSchema>;
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramCallbackQuery = z.infer<typeof telegramCallbackQuerySchema>;
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
