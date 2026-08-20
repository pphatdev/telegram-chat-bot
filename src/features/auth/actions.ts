"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import { bots, users } from "@/db/schema";
import { encrypt, hashPassword, verifyPassword } from "@/lib/crypto";
import { issueSession, clearSession } from "@/lib/auth/session";
import { TelegramApiError, TelegramClient } from "@/lib/telegram";
import {
    loginApiKeySchema,
    loginCredentialsSchema,
    signupSchema,
    type LoginApiKeyInput,
    type LoginCredentialsInput,
    type SignupInput,
} from "@/features/auth/schemas";

export type AuthResult = { ok: true } | { ok: false; error: string; field?: string };

/**
 * Turn a raw Telegram getMe() failure into a message a human can act on.
 * Telegram's own "Unauthorized" is indistinguishable from our app's session
 * errors, so we prefix it and add a hint.
 */
function describeTelegramError(err: unknown): string {
    if (!(err instanceof TelegramApiError)) return "Could not reach Telegram. Check your connection and try again.";
    if (err.errorCode === 401) return "Invalid or revoked bot token. Reissue it via @BotFather (/revoke → /token).";
    if (err.errorCode === 404) return "Telegram rejected this token as unknown. Double-check for typos.";
    return `Telegram: ${err.description}`;
}

/**
 * Log in with a Telegram Bot API token.
 *
 * Flow:
 *   1. Validate shape (delegated to the client-side Zod schema; re-validated
 *      here as the server never trusts the client).
 *   2. Hit Telegram getMe() to prove the token is live and grab bot metadata.
 *   3. Upsert the bot row (encrypting the token at rest).
 *   4. Ensure an owning user exists (auto-provisioned for API-key logins that
 *      have no matching credentials account).
 *   5. Issue the session cookie and return { ok: true }.
 */
export async function loginWithApiKey(input: LoginApiKeyInput): Promise<AuthResult> {
    const parsed = loginApiKeySchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const { env } = await getCloudflareContext({ async: true });
    const client = new TelegramClient({ token: parsed.data.token });

    let me;
    try {
        me = await client.getMe();
    } catch (err) {
        return { ok: false, error: describeTelegramError(err), field: "token" };
    }

    const db = await getDbAsync();
    const now = Math.floor(Date.now() / 1000);
    const encryptedToken = await encrypt(parsed.data.token, env.ENCRYPTION_SECRET);

    const existingBot = await db
        .select()
        .from(bots)
        .where(eq(bots.telegramBotId, me.id))
        .get();

    let userId: number;
    let botId: number;

    if (existingBot) {
        userId = existingBot.userId;
        botId = existingBot.id;
        await db
            .update(bots)
            .set({ encryptedToken, name: me.first_name, username: me.username ?? "", updatedAt: now })
            .where(eq(bots.id, existingBot.id))
            .run();
    } else {
        // Auto-provision an owning user for API-key-only logins. Password hash is
        // a random unusable string — the user must "sign up" to set a password.
        const placeholderEmail = `${me.username ?? `bot_${me.id}`}@bots.local`;
        const placeholderPasswordHash = await hashPassword(crypto.randomUUID());
        const insertedUser = await db
            .insert(users)
            .values({
                email: placeholderEmail,
                username: me.username ?? `bot_${me.id}`,
                passwordHash: placeholderPasswordHash,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoNothing()
            .returning({ id: users.id })
            .get();

        if (insertedUser) {
            userId = insertedUser.id;
        } else {
            const found = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.username, me.username ?? `bot_${me.id}`))
                .get();
            if (!found) return { ok: false, error: "Failed to provision user" };
            userId = found.id;
        }

        const insertedBot = await db
            .insert(bots)
            .values({
                userId,
                telegramBotId: me.id,
                username: me.username ?? "",
                name: me.first_name,
                encryptedToken,
                createdAt: now,
                updatedAt: now,
            })
            .returning({ id: bots.id })
            .get();
        if (!insertedBot) return { ok: false, error: "Failed to store bot" };
        botId = insertedBot.id;
    }

    await issueSession({ userId, botId });
    return { ok: true };
}

/**
 * Log in with username/password. Requires a bot already registered against
 * the user (which is guaranteed by signup).
 */
export async function loginWithCredentials(input: LoginCredentialsInput): Promise<AuthResult> {
    const parsed = loginCredentialsSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const db = await getDbAsync();
    const identifier = parsed.data.username.trim().toLowerCase();
    const user = await db
        .select()
        .from(users)
        .where(
            identifier.includes("@")
                ? eq(users.email, identifier)
                : eq(users.username, identifier),
        )
        .get();

    if (!user) {
        return { ok: false, error: "Invalid credentials" };
    }
    const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!passwordOk) {
        return { ok: false, error: "Invalid credentials" };
    }

    const primaryBot = await db
        .select({ id: bots.id })
        .from(bots)
        .where(eq(bots.userId, user.id))
        .get();
    if (!primaryBot) {
        return { ok: false, error: "No bot registered on this account" };
    }

    await issueSession({ userId: user.id, botId: primaryBot.id });
    return { ok: true };
}

/**
 * Sign up: create a user, validate their bot token, encrypt+store it, and
 * issue a session in one atomic-ish flow.
 */
export async function signup(input: SignupInput): Promise<AuthResult> {
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const { env } = await getCloudflareContext({ async: true });
    const db = await getDbAsync();

    // Uniqueness pre-check (the unique index would also catch it, but this
    // gives a friendlier field-specific error).
    const clash = await db
        .select({ email: users.email, username: users.username })
        .from(users)
        .where(
            // OR
            and(eq(users.email, parsed.data.email)),
        )
        .get();
    if (clash) {
        return { ok: false, error: "Email is already registered", field: "email" };
    }
    const usernameClash = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, parsed.data.username))
        .get();
    if (usernameClash) {
        return { ok: false, error: "Username is taken", field: "username" };
    }

    // Validate the token BEFORE mutating anything.
    const client = new TelegramClient({ token: parsed.data.apiKey });
    let me;
    try {
        me = await client.getMe();
    } catch (err) {
        return { ok: false, error: describeTelegramError(err), field: "apiKey" };
    }

    const now = Math.floor(Date.now() / 1000);
    const passwordHash = await hashPassword(parsed.data.password);
    const encryptedToken = await encrypt(parsed.data.apiKey, env.ENCRYPTION_SECRET);

    const insertedUser = await db
        .insert(users)
        .values({
            email: parsed.data.email,
            username: parsed.data.username,
            passwordHash,
            createdAt: now,
            updatedAt: now,
        })
        .returning({ id: users.id })
        .get();
    if (!insertedUser) {
        return { ok: false, error: "Failed to create account" };
    }

    const insertedBot = await db
        .insert(bots)
        .values({
            userId: insertedUser.id,
            telegramBotId: me.id,
            username: me.username ?? "",
            name: me.first_name,
            encryptedToken,
            createdAt: now,
            updatedAt: now,
        })
        .returning({ id: bots.id })
        .get();
    if (!insertedBot) {
        return { ok: false, error: "Failed to register bot" };
    }

    await issueSession({ userId: insertedUser.id, botId: insertedBot.id });
    return { ok: true };
}

export async function logout(): Promise<void> {
    await clearSession();
}
