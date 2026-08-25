/**
 * R2 object-key helpers.
 *
 * Keys are opaque UUIDs prefixed by `botId` so operational tooling can
 * scan / delete a single bot's media without enumerating everything.
 * Extension is preserved so Content-Type can be inferred on read if the
 * metadata is ever lost.
 *
 * Format: `media/{botId}/{uuid}{.ext}`
 */

const EXTENSION_FOR_MIME: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
};

export function generateMediaKey(botId: number, mimeType: string): string {
    const ext = EXTENSION_FOR_MIME[mimeType.toLowerCase()] ?? "";
    return `media/${botId}/${crypto.randomUUID()}${ext}`;
}

/**
 * Confirms a key looks like one we generated. Used by the streaming proxy
 * to reject enumeration attempts hitting arbitrary paths (a defense in
 * depth, not a substitute for R2's own object-not-found response).
 */
export function isMediaKey(key: string): boolean {
    return /^media\/\d+\/[a-f0-9-]{36}(\.[a-z0-9]+)?$/i.test(key);
}
