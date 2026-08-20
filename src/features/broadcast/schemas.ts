import { z } from "zod";

/**
 * Outbound message payload schemas.
 *
 * Server actions and the future scheduled-broadcast handler both consume
 * `outboundMessageSchema` as a discriminated union so downstream code can
 * pattern-match on `kind` without any runtime type-guessing.
 *
 * `mediaR2Key` (photo/document) is validated as a plain string — the
 * broadcast dispatcher composes the full `https://<r2-public-endpoint>/<key>`
 * URL and hands that to Telegram, so we never leak internal keys to clients.
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

export const outboundMessageSchema = z.discriminatedUnion("kind", [
    sendTextSchema,
    sendPhotoSchema,
    sendDocumentSchema,
]);

export type SendTextPayload = z.infer<typeof sendTextSchema>;
export type SendPhotoPayload = z.infer<typeof sendPhotoSchema>;
export type SendDocumentPayload = z.infer<typeof sendDocumentSchema>;
export type OutboundMessagePayload = z.infer<typeof outboundMessageSchema>;
export type InlineKeyboardMarkupInput = z.infer<typeof inlineKeyboardMarkupSchema>;
