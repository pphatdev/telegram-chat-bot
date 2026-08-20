/**
 * Webhook authentication utilities.
 *
 * Telegram signs every inbound webhook delivery with the shared secret
 * declared during setWebhook, echoed back in the
 * `X-Telegram-Bot-Api-Secret-Token` header. Every request MUST be verified
 * against the configured secret; unauthenticated calls are rejected with 401.
 *
 * Reference:
 * https://core.telegram.org/bots/api#setwebhook
 */

export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Timing-safe string equality comparison suitable for secret tokens.
 * Runs in O(max(len(a), len(b))) time regardless of where the mismatch is,
 * to prevent character-by-character timing side channels.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  const len = Math.max(bufA.byteLength, bufB.byteLength);
  let mismatch = bufA.byteLength ^ bufB.byteLength;
  for (let i = 0; i < len; i++) {
    const x = bufA[i] ?? 0;
    const y = bufB[i] ?? 0;
    mismatch |= x ^ y;
  }
  return mismatch === 0;
}

/**
 * Verifies the inbound request carries the expected shared secret.
 * Returns true only on an exact, non-empty, timing-safe match.
 */
export function verifyWebhookSecret(
  headers: Headers,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  const provided = headers.get(WEBHOOK_SECRET_HEADER);
  if (!provided) return false;
  return timingSafeEqual(provided, expected);
}
