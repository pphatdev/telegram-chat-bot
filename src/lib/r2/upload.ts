import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateMediaKey } from "./keys";

/**
 * MIME whitelist mirrors what Telegram's sendPhoto / sendVideo / sendAudio /
 * sendDocument actually accept — plus a size cap that keeps a single upload
 * well under the 50 MB Telegram limit and well within the Workers request-
 * body budget.
 */
export const MEDIA_LIMITS = {
    photo: {
        maxBytes: 10 * 1024 * 1024, // 10 MB
        mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    },
    video: {
        maxBytes: 50 * 1024 * 1024,
        mimes: ["video/mp4", "video/webm", "video/quicktime"],
    },
    audio: {
        maxBytes: 20 * 1024 * 1024,
        mimes: ["audio/mpeg", "audio/ogg", "audio/wav"],
    },
    document: {
        maxBytes: 50 * 1024 * 1024,
        mimes: ["application/pdf", "application/zip", "text/plain", "text/csv", "application/json"],
    },
} as const;

export type MediaKind = keyof typeof MEDIA_LIMITS;

export interface UploadedObject {
    kind: MediaKind;
    r2Key: string;
    mimeType: string;
    size: number;
}

export class MediaUploadError extends Error {
    constructor(
        public readonly code: "too_large" | "bad_mime" | "empty" | "put_failed",
        message: string,
    ) {
        super(message);
        this.name = "MediaUploadError";
    }
}

/**
 * Persist a Blob/File into R2 with all safety rails.
 *
 * Callers pass `hintKind` when they already know the intended send-mode
 * (e.g. the composer "Attach Photo" button); when omitted we infer from
 * MIME. Rejects unknown or oversized payloads with typed errors.
 */
export async function putMediaObject(
    botId: number,
    file: Blob,
    hintKind?: MediaKind,
): Promise<UploadedObject> {
    if (file.size === 0) {
        throw new MediaUploadError("empty", "Uploaded file is empty");
    }

    const mimeType = normalizeMime(file.type);
    const kind = hintKind ?? inferKindFromMime(mimeType);
    if (!kind) {
        throw new MediaUploadError("bad_mime", `Unsupported media type: ${mimeType || "(none)"}`);
    }

    const limits = MEDIA_LIMITS[kind];
    const acceptableMimes: readonly string[] = limits.mimes;
    if (!acceptableMimes.includes(mimeType)) {
        throw new MediaUploadError(
            "bad_mime",
            `${mimeType || "(none)"} is not permitted for ${kind} uploads`,
        );
    }
    if (file.size > limits.maxBytes) {
        throw new MediaUploadError(
            "too_large",
            `Upload exceeds ${Math.round(limits.maxBytes / (1024 * 1024))} MB limit for ${kind}`,
        );
    }

    const { env } = await getCloudflareContext({ async: true });
    const key = generateMediaKey(botId, mimeType);

    try {
        await env.R2.put(key, file.stream(), {
            httpMetadata: { contentType: mimeType },
            customMetadata: {
                botId: String(botId),
                kind,
                originalSize: String(file.size),
            },
        });
    } catch (err) {
        throw new MediaUploadError(
            "put_failed",
            err instanceof Error ? err.message : "R2 put failed",
        );
    }

    return { kind, r2Key: key, mimeType, size: file.size };
}

function normalizeMime(raw: string): string {
    return (raw || "").toLowerCase().trim().split(";")[0];
}

function inferKindFromMime(mime: string): MediaKind | null {
    if (mime.startsWith("image/")) return "photo";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (mime) return "document";
    return null;
}
