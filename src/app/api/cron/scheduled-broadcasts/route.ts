import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDbAsync } from "@/db/client";
import { broadcasts } from "@/db/schema";
import { runBroadcast } from "@/features/broadcast/sweep";
import { timingSafeEqual } from "@/lib/telegram/webhook";

/**
 * POST /api/cron/scheduled-broadcasts
 *
 * Sweep due scheduled broadcasts. See `src/features/broadcast/sweep.ts` for
 * the per-row dispatch semantics.
 *
 * Auth: X-Cron-Secret must match env.WEBHOOK_SECRET (reused; split into a
 * dedicated CRON_SECRET later if needed).
 *
 * Bounded to MAX_ROWS_PER_TICK so long queues drain across multiple ticks
 * rather than exhausting a single Worker invocation.
 *
 * Wiring to Cloudflare Cron Triggers requires an extended OpenNext worker
 * entrypoint that exports `scheduled()` — for now this endpoint is triggered
 * either by an external scheduler or by hand for testing.
 */
const MAX_ROWS_PER_TICK = 5;
const CRON_SECRET_HEADER = "x-cron-secret";

export async function POST(request: Request) {
    const { env } = await getCloudflareContext({ async: true });
    const provided = request.headers.get(CRON_SECRET_HEADER) ?? "";
    if (!env.WEBHOOK_SECRET || !timingSafeEqual(provided, env.WEBHOOK_SECRET)) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const db = await getDbAsync();
    const now = Math.floor(Date.now() / 1000);
    const due = await db
        .select()
        .from(broadcasts)
        .where(and(eq(broadcasts.status, "scheduled"), lte(broadcasts.runAt, now)))
        .limit(MAX_ROWS_PER_TICK)
        .all();

    const results = [];
    for (const bc of due) {
        results.push(await runBroadcast(db, bc));
    }
    return NextResponse.json({ ok: true, batch: due.length, results });
}

export function GET() {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
