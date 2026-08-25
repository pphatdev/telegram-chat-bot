import { z } from "zod";

/**
 * Outbound message payload schemas.
 *
 * Server actions and the scheduled-broadcast dispatcher both consume
 * `outboundMessageSchema` as a discriminated union so downstream code can
 * pattern-match on `kind` without any runtime type-guessing.
 *
 * `mediaR2Key` (photo/video/audio/document) is validated as a plain string —
 * the broadcast dispatcher composes the full media-proxy URL and hands that
 * to Telegram, so we never leak internal keys to clients.
 *
 * `stickerRef` is either a Telegram-issued `file_id` or a sticker set name —
 * whatever the composer surfaces from the picker. The access-control sticker
 * guard matches on this string against the `sticker` allowlist rules.
 */

const inlineKeyboardButtonSchema = z
    .object({
        text: z.string().min(1).max(64),
        url: z.string().url().optional(),
        callback_data: z.string().max(64).optional(),
    })
    .refine((b) => Boolean(b.url) !== Boolean(b.callback_data), {
        message: "Button must have exactly one of `url` or `callback_data`",
    });

const inlineKeyboardMarkupSchema = z.object({
    inline_keyboard: z.array(z.array(inlineKeyboardButtonSchema).min(1).max(8)).min(1).max(8),
});

const commonFields = {
    replyToMessageId: z.number().int().positive().optional(),
    parseMode: z.enum(["MarkdownV2", "HTML", "Markdown"]).optional(),
    replyMarkup: inlineKeyboardMarkupSchema.optional(),
    disableNotification: z.boolean().optional(),
};

export const sendTextSchema = z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(4096),
    ...commonFields,
});

export const sendPhotoSchema = z.object({
    kind: z.literal("photo"),
    mediaR2Key: z.string().min(1),
    caption: z.string().max(1024).optional(),
    ...commonFields,
});

export const sendDocumentSchema = z.object({
    kind: z.literal("document"),
    mediaR2Key: z.string().min(1),
    caption: z.string().max(1024).optional(),
    ...commonFields,
});

export const sendVideoSchema = z.object({
    kind: z.literal("video"),
    mediaR2Key: z.string().min(1),
    caption: z.string().max(1024).optional(),
    duration: z.number().int().positive().max(60 * 60 * 6).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    supportsStreaming: z.boolean().optional(),
    ...commonFields,
});

export const sendAudioSchema = z.object({
    kind: z.literal("audio"),
    mediaR2Key: z.string().min(1),
    caption: z.string().max(1024).optional(),
    duration: z.number().int().positive().max(60 * 60 * 6).optional(),
    performer: z.string().max(64).optional(),
    title: z.string().max(64).optional(),
    ...commonFields,
});

export const sendStickerSchema = z.object({
    kind: z.literal("sticker"),
    /** Telegram `file_id` OR sticker set name — matched against sticker guard rules. */
    stickerRef: z.string().min(1).max(200),
    emoji: z.string().max(8).optional(),
    ...commonFields,
});

export const outboundMessageSchema = z.discriminatedUnion("kind", [
    sendTextSchema,
    sendPhotoSchema,
    sendDocumentSchema,
    sendVideoSchema,
    sendAudioSchema,
    sendStickerSchema,
]);

export type SendTextPayload = z.infer<typeof sendTextSchema>;
export type SendPhotoPayload = z.infer<typeof sendPhotoSchema>;
export type SendDocumentPayload = z.infer<typeof sendDocumentSchema>;
export type SendVideoPayload = z.infer<typeof sendVideoSchema>;
export type SendAudioPayload = z.infer<typeof sendAudioSchema>;
export type SendStickerPayload = z.infer<typeof sendStickerSchema>;
export type OutboundMessagePayload = z.infer<typeof outboundMessageSchema>;
export type InlineKeyboardMarkupInput = z.infer<typeof inlineKeyboardMarkupSchema>;
