import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { rateLimits } from "../db/schema";
import type { BucketState, TokenBucketStore } from "./token-bucket";

/**
 * D1-backed store for the token-bucket limiter. One row per (botId, key)
 * survives across requests and Worker instances.
 *
 * D1 does not yet support serializable transactions across statements, so
 * `transact()` reads the current row, computes the mutation, then writes
 * with an equality guard on `updatedAt`. On a concurrent-write race the
 * caller retries — bounded by `maxAttempts` so we never spin forever.
 */
export function createD1RateLimitStore(
  db: AppDatabase,
  botId: number,
  maxAttempts = 4,
): TokenBucketStore {
  return {
    async transact(key, mutate) {
      let lastErr: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const now = Date.now();
        const existing = await db
          .select()
          .from(rateLimits)
          .where(and(eq(rateLimits.botId, botId), eq(rateLimits.key, key)))
          .get();

        const state: BucketState | null = existing
          ? { tokensX1000: existing.tokensX1000, updatedAt: existing.updatedAt }
          : null;

        const { next, result } = mutate(state, now);

        try {
          if (existing) {
            const upd = await db
              .update(rateLimits)
              .set({ tokensX1000: next.tokensX1000, updatedAt: next.updatedAt })
              .where(
                and(
                  eq(rateLimits.botId, botId),
                  eq(rateLimits.key, key),
                  eq(rateLimits.updatedAt, existing.updatedAt),
                ),
              )
              .run();
            if (upd.meta.changes === 0) {
              // Lost the CAS race; refetch and retry.
              continue;
            }
          } else {
            await db
              .insert(rateLimits)
              .values({
                botId,
                key,
                tokensX1000: next.tokensX1000,
                updatedAt: next.updatedAt,
              })
              .run();
          }
          return result;
        } catch (err) {
          lastErr = err;
          // UNIQUE conflict on (bot_id, key) → another writer just inserted;
          // retry with the freshly persisted state.
          continue;
        }
      }
      throw lastErr ?? new Error("rate-limit: transact exceeded max attempts");
    },
  };
}
