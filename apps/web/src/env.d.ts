/**
 * Type augmentation for CloudflareEnv covering runtime secrets that Wrangler
 * only surfaces in the generated `cloudflare-env.d.ts` when `.dev.vars` is
 * present locally. We declare them here unconditionally so the type checker
 * and IDE always know these bindings exist — the runtime values come from
 * `.dev.vars` locally and `wrangler secret put` in production.
 *
 * Keep this file in sync with `.dev.vars.example`.
 */

import type { ChatFeedHub } from "@/lib/realtime/chat-feed-hub";

declare global {
    interface CloudflareEnv {
        /**
         * 32-byte base64 key used for AES-GCM-256 encrypt-at-rest, HMAC
         * session signing, and per-bot Telegram webhook secret derivation.
         */
        ENCRYPTION_SECRET: string;
        /**
         * Shared secret required by the admin-triggered cron sweep endpoint
         * (X-Cron-Secret header on POST /api/cron/scheduled-broadcasts).
         * The scheduled() worker export bypasses this — it runs inside the
         * worker itself so no external caller is involved.
         */
        CRON_SECRET: string;
        /** Public origin (https://...) Telegram uses to fetch media broadcasts through /api/media/[key]. */
        PUBLIC_APP_URL: string;
        /** Realtime chat-list fanout hub. One DO instance per botId (routed via idFromName). */
        CHAT_FEED: DurableObjectNamespace<ChatFeedHub>;
    }
}

export {};
