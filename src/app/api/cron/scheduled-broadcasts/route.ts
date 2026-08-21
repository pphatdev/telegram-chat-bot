import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { getDbAsync } from "@/db/client";
import { runBroadcast, selectDueBroadcasts } from "@/features/broadcast/sweep";
import { timingSafeEqual } from "@/lib/telegram/webhook";

/**
 * POST /api/cron/scheduled-broadcasts
 *
 * Admin-triggered sweep of due scheduled broadcasts. Useful for:
 *   - Local dev where the Cloudflare Cron Trigger isn't wired up
 *     (miniflare doesn't run schedules for `next dev`).
 *   - Kicking the queue immediately after fixing a broken broadcast
 *     without waiting for the next tick.
 *
 * The production sweep runs from the `scheduled()` export appended to the
 * OpenNext worker by `scripts/patch-open-next-worker.mjs` — that path
 * doesn't come through here, so this endpoint is purely a manual override.
 *
 * Auth: `X-Cron-Secret` must match `env.CRON_SECRET`. Bounded to
 * `MAX_ROWS_PER_TICK` so a stuck queue can't exhaust a single Worker
 * invocation on manual retry.
 */
const MAX_ROWS_PER_TICK = 5;
const CRON_SECRET_HEADER = "x-cron-secret";

export async function POST(request: Request) {
    const { env } = await getCloudflareContext({ async: true });
    const provided = request.headers.get(CRON_SECRET_HEADER) ?? "";
    if (!env.CRON_SECRET || !timingSafeEqual(provided, env.CRON_SECRET)) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const db = await getDbAsync();
    const due = await selectDueBroadcasts(db, MAX_ROWS_PER_TICK);

    const results = [];
    for (const bc of due) {
        results.push(await runBroadcast(db, bc));
    }
    return NextResponse.json({ ok: true, batch: due.length, results });
}

export function GET() {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
