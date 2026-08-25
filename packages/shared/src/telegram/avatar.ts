import { TelegramApiError, TelegramClient, TelegramNetworkError } from "./client";

/**
 * Lazy avatar fetcher — downloads Telegram profile photos on demand and
 * caches them in R2.
 *
 * Design:
 *   - Keys are stable per (botId, kind, telegramId): re-running the fetch
 *     overwrites the same object rather than piling up variants.
 *   - Cache lifetime is 7 days. Telegram avatars change rarely; a stale
 *     week is an acceptable trade-off against re-hitting api.telegram.org
 *     on every page render.
 *   - No `Content-Type` sniffing — we trust Telegram's Content-Type from
 *     the download response.
 *   - Missing photos (chat has no picture) are cached as a zero-byte
 *     placeholder so the next request short-circuits to a 404 without
 *     another Telegram round-trip.
 *
 * Runtime: this file runs inside Cloudflare Workers via the API routes
 * that own the R2 binding. No Node-only APIs.
 */

const AVATAR_TTL_SECONDS = 7 * 24 * 60 * 60;
const NOT_FOUND_SENTINEL_HEADER = "x-avatar-not-found";

export type AvatarKind = "chat" | "user";

export interface AvatarKeyInput {
    botId: number;
    kind: AvatarKind;
    /** Telegram id of the chat or user. */
    telegramId: number;
}

export function avatarObjectKey({ botId, kind, telegramId }: AvatarKeyInput): string {
    return `avatars/${botId}/${kind}/${telegramId}.jpg`;
}

export interface AvatarResult {
    /** true → object exists in R2 and can be streamed. */
    ok: boolean;
    /** true → known-empty; the target has no profile photo. */
    notFound: boolean;
    /** R2 object key when ok is true. */
    key?: string;
    /** Human-readable message when ok is false (network / API error). */
    error?: string;
}

interface EnsureOptions {
    r2: R2Bucket;
    client: TelegramClient;
    botId: number;
    /**
     * If true, skip the R2 cache lookup and force a fresh Telegram fetch.
     * Used by the "Refresh avatar" affordance and when the operator wants
     * to invalidate a stale image.
     */
    force?: boolean;
}

/**
 * Ensure a chat's avatar is cached in R2. Idempotent: re-runs are no-ops
 * for chats whose avatar is already cached (unless `force=true`).
 */
export async function ensureChatAvatar(
    telegramChatId: number,
    opts: EnsureOptions,
): Promise<AvatarResult> {
    const key = avatarObjectKey({ botId: opts.botId, kind: "chat", telegramId: telegramChatId });
    if (!opts.force) {
        const cached = await readCached(opts.r2, key);
        if (cached) return cached;
    }

    let photoFileId: string | undefined;
    try {
        const chat = await opts.client.getChat(telegramChatId);
        photoFileId = chat.photo?.small_file_id;
    } catch (err) {
        return errFromTelegram(err);
    }

    if (!photoFileId) {
        await writeNotFoundSentinel(opts.r2, key);
        return { ok: false, notFound: true, key };
    }

    return downloadAndCache(photoFileId, key, opts);
}

/**
 * Ensure a user's avatar is cached in R2. Users can have zero photos, in
 * which case we cache a "not found" sentinel so subsequent requests
 * short-circuit.
 */
export async function ensureUserAvatar(
    telegramUserId: number,
    opts: EnsureOptions,
): Promise<AvatarResult> {
    const key = avatarObjectKey({ botId: opts.botId, kind: "user", telegramId: telegramUserId });
    if (!opts.force) {
        const cached = await readCached(opts.r2, key);
        if (cached) return cached;
    }

    let photoFileId: string | undefined;
    try {
        const photos = await opts.client.getUserProfilePhotos(telegramUserId, { limit: 1 });
        // Pick the smallest (first) size — avatars render at ≤48px anyway.
        photoFileId = photos.photos[0]?.[0]?.file_id;
    } catch (err) {
        return errFromTelegram(err);
    }

    if (!photoFileId) {
        await writeNotFoundSentinel(opts.r2, key);
        return { ok: false, notFound: true, key };
    }

    return downloadAndCache(photoFileId, key, opts);
}

async function downloadAndCache(
    fileId: string,
    key: string,
    opts: EnsureOptions,
): Promise<AvatarResult> {
    let filePath: string | undefined;
    try {
        const file = await opts.client.getFile(fileId);
        filePath = file.file_path;
    } catch (err) {
        return errFromTelegram(err);
    }
    if (!filePath) return { ok: false, notFound: false, error: "Telegram returned no file_path" };

    let download: Response;
    try {
        download = await opts.client.downloadFile(filePath);
    } catch (err) {
        return errFromTelegram(err);
    }

    const contentType = download.headers.get("content-type") ?? "image/jpeg";
    if (!download.body) return { ok: false, notFound: false, error: "empty download body" };

    // Buffer the download into memory before handing it to R2. Miniflare's
    // R2 emulator in `next dev` doesn't reliably accept a `ReadableStream`
    // as the put body — passing an ArrayBuffer is portable across both
    // miniflare and prod workerd. Avatars are ≤ a few hundred KB so the
    // in-worker allocation is cheap.
    let bytes: ArrayBuffer;
    try {
        bytes = await download.arrayBuffer();
    } catch (err) {
        return {
            ok: false,
            notFound: false,
            error: `failed to buffer avatar download: ${err instanceof Error ? err.message : "unknown"}`,
        };
    }

    try {
        await opts.r2.put(key, bytes, {
            httpMetadata: { contentType, cacheControl: `public, max-age=${AVATAR_TTL_SECONDS}` },
        });
    } catch (err) {
        console.error(`[avatar] r2.put failed for key ${key}:`, err);
        return {
            ok: false,
            notFound: false,
            error: `r2 put failed: ${err instanceof Error ? err.message : "unknown"}`,
        };
    }
    return { ok: true, notFound: false, key };
}

/**
 * Peek R2 for a cached avatar. Returns null (fresh miss), a hit, or a
 * not-found sentinel (cached negative — we know Telegram has no photo).
 * Sentinel objects are stored with a distinguishing header + zero body so
 * we never serve them as real image bytes.
 *
 * Any R2 read failure is swallowed as a cache miss — the caller falls
 * through to a fresh Telegram fetch, which is safer than propagating a
 * 500 to the client for an infrastructure hiccup.
 */
async function readCached(r2: R2Bucket, key: string): Promise<AvatarResult | null> {
    let head;
    try {
        head = await r2.head(key);
    } catch (err) {
        console.error(`[avatar] r2.head failed for key ${key}:`, err);
        return null;
    }
    if (!head) return null;
    const uploaded = head.uploaded?.getTime?.() ?? 0;
    if (uploaded && Date.now() - uploaded > AVATAR_TTL_SECONDS * 1000) {
        // Expired — treat as miss so the caller re-fetches.
        return null;
    }
    if (head.customMetadata?.[NOT_FOUND_SENTINEL_HEADER] === "1") {
        return { ok: false, notFound: true, key };
    }
    return { ok: true, notFound: false, key };
}

async function writeNotFoundSentinel(r2: R2Bucket, key: string): Promise<void> {
    try {
        await r2.put(key, new Uint8Array(), {
            customMetadata: { [NOT_FOUND_SENTINEL_HEADER]: "1" },
            httpMetadata: { cacheControl: `public, max-age=${AVATAR_TTL_SECONDS}` },
        });
    } catch (err) {
        // Sentinel writes are best-effort — the next request just re-fetches.
        console.error(`[avatar] r2.put sentinel failed for key ${key}:`, err);
    }
}

function errFromTelegram(err: unknown): AvatarResult {
    if (err instanceof TelegramApiError) {
        // "Bad Request: chat not found" / "USER_NOT_FOUND" — treat as not-found
        // so we don't churn on every render.
        if (err.errorCode === 400 || err.errorCode === 404) {
            return { ok: false, notFound: true, error: err.description };
        }
        return { ok: false, notFound: false, error: `${err.errorCode}: ${err.description}` };
    }
    if (err instanceof TelegramNetworkError) {
        return { ok: false, notFound: false, error: `network: ${err.cause}` };
    }
    return { ok: false, notFound: false, error: err instanceof Error ? err.message : "unknown" };
}
