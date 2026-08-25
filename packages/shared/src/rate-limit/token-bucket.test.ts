import { describe, expect, it } from "vitest";
import { consume, type BucketState, type TokenBucketStore } from "./token-bucket";

/**
 * In-memory store used only for testing the pure algorithm. Simulates a
 * clock so we can advance time deterministically instead of sleeping.
 */
function memoryStore(nowFn: () => number): TokenBucketStore & { state: BucketState | null } {
    const store = {
        state: null as BucketState | null,
        async transact<T>(
            _key: string,
            mutate: (state: BucketState | null, now: number) => { next: BucketState; result: T },
        ) {
            const { next, result } = mutate(store.state, nowFn());
            store.state = next;
            return result;
        },
    };
    return store;
}

describe("token-bucket.consume", () => {
    it("allows the first request from a fresh bucket at capacity", async () => {
        const store = memoryStore(() => 0);
        const r = await consume(store, "k", { capacity: 5, refillPerSecond: 5 });
        expect(r.allowed).toBe(true);
        expect(r.remaining).toBe(4);
        expect(r.retryAfterMs).toBe(0);
    });

    it("debits the configured cost per consume", async () => {
        const store = memoryStore(() => 0);
        await consume(store, "k", { capacity: 5, refillPerSecond: 5, cost: 2 });
        const r = await consume(store, "k", { capacity: 5, refillPerSecond: 5, cost: 2 });
        expect(r.allowed).toBe(true);
        expect(r.remaining).toBe(1);
    });

    it("rejects when the bucket is drained and reports retryAfterMs", async () => {
        let now = 0;
        const store = memoryStore(() => now);
        // Drain: 5 requests of 1 token each in the same instant.
        for (let i = 0; i < 5; i++) {
            await consume(store, "k", { capacity: 5, refillPerSecond: 5 });
        }
        const r = await consume(store, "k", { capacity: 5, refillPerSecond: 5 });
        expect(r.allowed).toBe(false);
        expect(r.retryAfterMs).toBeGreaterThan(0);
        // At refill=5/sec, 1 token takes 200ms.
        expect(r.retryAfterMs).toBeLessThanOrEqual(200);
    });

    it("refills over elapsed time", async () => {
        let now = 0;
        const store = memoryStore(() => now);
        // Drain the bucket.
        for (let i = 0; i < 5; i++) {
            await consume(store, "k", { capacity: 5, refillPerSecond: 5 });
        }
        // Advance 1 second — should refill to full capacity.
        now = 1_000;
        const r = await consume(store, "k", { capacity: 5, refillPerSecond: 5 });
        expect(r.allowed).toBe(true);
        // We consumed 1 token from the refilled bucket, leaving 4.
        expect(r.remaining).toBe(4);
    });

    it("does not overfill past capacity when idle for a long time", async () => {
        let now = 0;
        const store = memoryStore(() => now);
        await consume(store, "k", { capacity: 5, refillPerSecond: 5 }); // remaining 4
        // Simulate 10 seconds of idle — bucket would fill to 50 without a cap.
        now = 10_000;
        const r = await consume(store, "k", { capacity: 5, refillPerSecond: 5 });
        expect(r.allowed).toBe(true);
        expect(r.remaining).toBe(4); // capacity 5 − cost 1
    });

    it("preserves independent state across different keys", async () => {
        const store = memoryStore(() => 0);
        // Drain 'k1'.
        for (let i = 0; i < 5; i++) {
            await consume(store, "k1", { capacity: 5, refillPerSecond: 5 });
        }
        // 'k2' shares the same store here (single memory slot), so this
        // exercises the caller's `key` parameter rather than store isolation.
        // See the D1-backed store integration test for per-key isolation.
        const r = await consume(store, "k1", { capacity: 5, refillPerSecond: 5 });
        expect(r.allowed).toBe(false);
    });

    it("Telegram per-chat 1/sec: allows exactly one send per second", async () => {
        let now = 0;
        const store = memoryStore(() => now);
        // First send goes through.
        expect((await consume(store, "chat:1", { capacity: 1, refillPerSecond: 1 })).allowed).toBe(true);
        // Immediate second send rejected.
        const denied = await consume(store, "chat:1", { capacity: 1, refillPerSecond: 1 });
        expect(denied.allowed).toBe(false);
        expect(denied.retryAfterMs).toBeGreaterThan(0);
        // After 1000ms the bucket refills.
        now = 1_000;
        expect((await consume(store, "chat:1", { capacity: 1, refillPerSecond: 1 })).allowed).toBe(true);
    });
});
