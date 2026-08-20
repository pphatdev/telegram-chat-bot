/**
 * Token-bucket rate limiter.
 *
 * Pure algorithm decoupled from persistence so callers can back it with D1
 * (see `./d1-store.ts`), an in-memory Map (tests), or a Durable Object as
 * scale demands. The bucket refills continuously at `refillPerSecond` up to
 * `capacity`; each `consume()` withdraws `cost` tokens or reports the
 * `retryAfterMs` until enough tokens accrue.
 *
 * Fractional tokens are represented as integer thousandths (`tokensX1000`)
 * so the store never has to persist floats — friendlier for SQL and
 * cheaper to compare atomically.
 *
 * Telegram's published limits translate to two nested buckets per bot:
 *   - `global`             → capacity 30, refill 30/sec
 *   - `chat:<chatId>`      → capacity 1,  refill 1/sec
 */

export interface BucketState {
  tokensX1000: number;
  updatedAt: number; // unix ms
}

export interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
  cost?: number;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface TokenBucketStore {
  /**
   * Atomically read-modify-write the bucket for `key`. Implementations must
   * guarantee that concurrent `consume()` calls for the same key see a
   * consistent view — with D1 this means wrapping in a transaction or using
   * a compare-and-swap update.
   */
  transact<T>(
    key: string,
    mutate: (state: BucketState | null, now: number) => { next: BucketState; result: T },
  ): Promise<T>;
}

export function consume(
  store: TokenBucketStore,
  key: string,
  config: BucketConfig,
): Promise<ConsumeResult> {
  const cost = config.cost ?? 1;
  const costX1000 = Math.max(1, Math.round(cost * 1000));
  const capacityX1000 = Math.round(config.capacity * 1000);
  const refillPerMsX1000 = (config.refillPerSecond * 1000) / 1000; // tokensX1000 per ms

  return store.transact<ConsumeResult>(key, (prev, now) => {
    const startX1000 = prev
      ? Math.min(
          capacityX1000,
          prev.tokensX1000 + Math.floor((now - prev.updatedAt) * refillPerMsX1000),
        )
      : capacityX1000;

    if (startX1000 >= costX1000) {
      const nextX1000 = startX1000 - costX1000;
      const result: ConsumeResult = {
        allowed: true,
        remaining: nextX1000 / 1000,
        retryAfterMs: 0,
      };
      return { next: { tokensX1000: nextX1000, updatedAt: now }, result };
    }

    const shortfallX1000 = costX1000 - startX1000;
    const retryAfterMs = Math.ceil(shortfallX1000 / refillPerMsX1000);
    const result: ConsumeResult = {
      allowed: false,
      remaining: startX1000 / 1000,
      retryAfterMs,
    };
    return { next: { tokensX1000: startX1000, updatedAt: now }, result };
  });
}
