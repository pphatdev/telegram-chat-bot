import type { AppDatabase } from "../db";
import { createD1RateLimitStore } from "./d1-store";
import { consume, type ConsumeResult } from "./token-bucket";

/**
 * Telegram Bot API rate limits, per the published guidance:
 *   - Global send throughput:   30 messages / second
 *   - Per-chat send throughput:  1 message  / second
 *
 * Every outbound dispatch must clear BOTH buckets. Callers should attempt
 * `assertTelegramSendAllowed` and back off `retryAfterMs` on rejection.
 */

const GLOBAL = { capacity: 30, refillPerSecond: 30 } as const;
const PER_CHAT = { capacity: 1, refillPerSecond: 1 } as const;

export interface TelegramRateResult extends ConsumeResult {
  bucket: "global" | "chat";
}

export async function assertTelegramSendAllowed(
  db: AppDatabase,
  botId: number,
  telegramChatId: number,
): Promise<TelegramRateResult> {
  const store = createD1RateLimitStore(db, botId);

  const perChat = await consume(store, `chat:${telegramChatId}`, PER_CHAT);
  if (!perChat.allowed) {
    return { ...perChat, bucket: "chat" };
  }

  const global = await consume(store, "global", GLOBAL);
  return { ...global, bucket: "global" };
}
