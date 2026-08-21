import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { anonRateLimits } from "@/db/schema";
import type { BucketState, TokenBucketStore } from "./token-bucket";

/**
 * D1-backed rate-limit store for buckets that are NOT scoped to a bot.
 *
 * Used by the un-authenticated media proxy to cap per-IP request rate. Same
 * CAS pattern as `createD1RateLimitStore`: read current row, compute new
 * state, write back guarded on the old `updatedAt`. On lost races we retry
 * up to `maxAttempts` times.
 */
export function createD1AnonRateLimitStore(
    db: AppDatabase,
    maxAttempts = 4,
): TokenBucketStore {
    return {
        async transact(key, mutate) {
            let lastErr: unknown;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const now = Date.now();
                const existing = await db
                    .select()
                    .from(anonRateLimits)
                    .where(eq(anonRateLimits.key, key))
                    .get();

                const state: BucketState | null = existing
                    ? { tokensX1000: existing.tokensX1000, updatedAt: existing.updatedAt }
                    : null;

                const { next, result } = mutate(state, now);

                try {
                    if (existing) {
                        const upd = await db
                            .update(anonRateLimits)
                            .set({ tokensX1000: next.tokensX1000, updatedAt: next.updatedAt })
                            .where(
                                and(
                                    eq(anonRateLimits.key, key),
                                    eq(anonRateLimits.updatedAt, existing.updatedAt),
                                ),
                            )
                            .run();
                        if (upd.meta.changes === 0) {
                            // Lost the CAS race; refetch and retry.
                            continue;
                        }
                    } else {
                        await db
                            .insert(anonRateLimits)
                            .values({
                                key,
                                tokensX1000: next.tokensX1000,
                                updatedAt: next.updatedAt,
                            })
                            .run();
                    }
                    return result;
                } catch (err) {
                    lastErr = err;
                    // UNIQUE conflict on `key` → another writer just inserted;
                    // retry with the freshly persisted state.
                    continue;
                }
            }
            throw lastErr ?? new Error("anon-rate-limit: transact exceeded max attempts");
        },
    };
}
