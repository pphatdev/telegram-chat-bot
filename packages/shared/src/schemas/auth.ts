import { z } from "zod";

/**
 * Auth form validation schemas — the source of truth for both the client-side
 * react-hook-form validation and (in a later phase) the server-action Zod
 * checks. Keeping both sides on the same schema prevents client/server drift.
 *
 * Telegram Bot token format per BotFather: `<numeric_bot_id>:<35-char-token>`,
 * e.g. `123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawa`. We validate shape
 * only — the wire-up to `TelegramClient.getMe()` will confirm the token is
 * actually accepted by Telegram.
 */

const TELEGRAM_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

export const loginApiKeySchema = z.object({
    token: z
        .string()
        .min(1, "Bot token is required")
        .regex(TELEGRAM_TOKEN_RE, "Invalid Telegram Bot token format"),
});

export const loginCredentialsSchema = z.object({
    username: z
        .string()
        .min(1, "Username or email is required")
        .max(120, "Too long"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

export const signupSchema = z
    .object({
        name: z.string().min(1, "Name is required").max(120, "Too long"),
        username: z
            .string()
            .min(3, "Username must be at least 3 characters")
            .max(60, "Too long")
            .regex(/^[a-zA-Z0-9_.-]+$/, "Only letters, numbers, . _ -"),
        email: z.string().email("Enter a valid email address"),
        apiKey: z
            .string()
            .min(1, "Bot token is required")
            .regex(TELEGRAM_TOKEN_RE, "Invalid Telegram Bot token format"),
        password: z.string().min(6, "Password must be at least 6 characters"),
        confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, {
        path: ["confirmPassword"],
        message: "Passwords do not match",
    });

export type LoginApiKeyInput = z.infer<typeof loginApiKeySchema>;
export type LoginCredentialsInput = z.infer<typeof loginCredentialsSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
