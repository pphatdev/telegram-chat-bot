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

import type { TelegramClient } from "./client";

export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Update kinds the app currently understands. Anything not in this list is
 * dropped by Telegram before it ever hits us — narrower allowlist means less
 * noise and a smaller attack surface for parsing bugs.
 */
export const WEBHOOK_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "callback_query",
] as const;

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

export interface RegisterBotWebhookOptions {
  /** Public HTTPS origin the app is reachable at, e.g. `https://bot.example.com`. */
  publicAppUrl: string;
  /** Internal `bots.id` — becomes the last path segment so we know who owns the update. */
  botId: number;
  /**
   * Shared secret echoed back in `X-Telegram-Bot-Api-Secret-Token`. Produced
   * by {@link deriveWebhookSecret} from the owning user's `passwordHash`, so
   * every bot has its own secret and there is no cross-bot replay surface.
   */
  secretToken: string;
}

/**
 * Point Telegram at our per-bot webhook. Without this call Telegram has no
 * idea where to POST when a user clicks "Start", so the very first inbound
 * `/start` message is silently dropped and the chat never appears in our
 * sidebar. Invoked from the auth actions after every successful login/signup
 * with a bot token, and safe to call repeatedly — setWebhook is idempotent.
 *
 * Pre-validates `publicAppUrl` is HTTPS — Telegram rejects http:// with
 * `Bad Request: bad webhook: An HTTPS URL must be provided for webhook`.
 * Catching this client-side lets us surface a friendlier message than
 * Telegram's terse response, and short-circuits before the wire call.
 */
export async function registerBotWebhook(
  client: TelegramClient,
  { publicAppUrl, botId, secretToken }: RegisterBotWebhookOptions,
): Promise<void> {
  if (!publicAppUrl) {
    throw new Error(
      "PUBLIC_APP_URL is not set — Telegram cannot deliver webhook updates without it. Set it in .dev.vars (local) or via wrangler secret (prod) to the public HTTPS origin your app is reachable at.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(publicAppUrl);
  } catch {
    throw new Error(
      `PUBLIC_APP_URL is not a valid URL: "${publicAppUrl}". Expected an HTTPS origin like https://my-bot.trycloudflare.com.`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `PUBLIC_APP_URL must use https:// — got "${parsed.protocol}//". Telegram requires HTTPS for webhooks. For local dev, tunnel your port with Cloudflare Tunnel (\`cloudflared tunnel --url http://localhost:3000\`) or ngrok (\`ngrok http 3000\`), then set PUBLIC_APP_URL to the tunnel's HTTPS URL.`,
    );
  }
  if (!secretToken) {
    throw new Error(
      "Refusing to register an unauthenticated webhook — derived secret is empty.",
    );
  }
  const url = new URL(`/api/telegram/webhook/${botId}`, publicAppUrl).toString();
  await client.setWebhook({
    url,
    secret_token: secretToken,
    allowed_updates: [...WEBHOOK_ALLOWED_UPDATES],
  });
}

/**
 * Derive the per-bot webhook secret from the owning user's PBKDF2 password
 * hash. Same `(passwordHash, botId)` → same secret, so verification is a
 * pure lookup at request time; no extra column on `bots`.
 *
 * Why HMAC and not raw hash? The stored `passwordHash` contains `$` `+` `/`
 * `=`, none of which are allowed in Telegram's `secret_token` charset. We
 * HMAC-SHA256 the botId with the passwordHash as key, then base64url-encode
 * the 32-byte tag — 43 chars, well under Telegram's 256-char cap.
 *
 * Rotation semantics: if the user rotates their password, `passwordHash`
 * changes and every derived secret invalidates. The caller (auth actions
 * on the next login) must re-register the webhook so Telegram picks up the
 * new secret.
 */
export async function deriveWebhookSecret(
  passwordHash: string,
  botId: number,
): Promise<string> {
  if (!passwordHash) {
    throw new Error("deriveWebhookSecret: passwordHash is required");
  }
  if (!Number.isFinite(botId) || botId <= 0) {
    throw new Error("deriveWebhookSecret: botId must be a positive integer");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passwordHash) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`telegram-webhook:${botId}`) as BufferSource,
  );
  return base64urlEncode(new Uint8Array(sig));
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
