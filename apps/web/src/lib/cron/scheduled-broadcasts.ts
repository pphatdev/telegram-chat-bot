import { buildDb } from "@telegram-bot/shared/db";
import { runBroadcast, selectDueBroadcasts } from "@/features/broadcast/sweep";

/**
 * Cron entrypoint for the "sweep due scheduled broadcasts" trigger.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE HTTP ADMIN ROUTE
 *   Cloudflare's `scheduled()` worker handler runs OUTSIDE OpenNext's fetch
 *   pipeline, so `getCloudflareContext()` — the mechanism the rest of the
 *   app uses to grab `env` — throws when called from here. Instead the
 *   Worker runtime hands `env` directly to `scheduled(event, env, ctx)`.
 *
 *   To make that env available deep in the sweep + dispatcher call chain we
 *   thread it through explicitly rather than relying on OpenNext's
 *   request-scoped storage. `buildDb(env.DB)` and `runBroadcast(db, bc, env)`
 *   accept the bindings up-front.
 *
 * PACKAGING
 *   `scripts/patch-open-next-worker.mjs` bundles this file to a sibling
 *   ES module and appends a `scheduled()` export to the OpenNext worker that
 *   calls back into `runScheduledBroadcasts`.
 *
 * BUDGET
 *   Bounded to MAX_ROWS_PER_TICK so a stuck queue can't exhaust the 30s
 *   Worker CPU budget in a single invocation. Anything not drained comes
 *   back next tick — the per-target ledger ensures no work is repeated.
 */

const MAX_ROWS_PER_TICK = 10;

export interface ScheduledBroadcastsResult {
    processed: number;
    dispatched: number;
    failed: number;
    pending: number;
}

export async function runScheduledBroadcasts(
    env: CloudflareEnv,
): Promise<ScheduledBroadcastsResult> {
    const db = buildDb(env.DB);
    const due = await selectDueBroadcasts(db, MAX_ROWS_PER_TICK);

    let dispatched = 0;
    let failed = 0;
    let pending = 0;
    for (const bc of due) {
        const result = await runBroadcast(db, bc, env);
        dispatched += result.dispatched;
        failed += result.failed;
        pending += result.pending;
    }
    return { processed: due.length, dispatched, failed, pending };
}
