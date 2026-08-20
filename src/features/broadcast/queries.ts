import { desc, eq } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import { broadcasts, type BroadcastRow } from "@/db/schema";

/**
 * Server-side read of broadcast history for a bot. Ordered newest-first,
 * bounded to `limit` rows (max 200) to keep the page responsive on busy
 * accounts.
 *
 * Called from server components — the client-facing action equivalent is
 * `listBroadcasts` in actions.ts, which wraps this in a session guard.
 */
export async function getBroadcastsForBot(
    botId: number,
    limit = 50,
): Promise<BroadcastRow[]> {
    const db = await getDbAsync();
    return db
        .select()
        .from(broadcasts)
        .where(eq(broadcasts.botId, botId))
        .orderBy(desc(broadcasts.createdAt))
        .limit(Math.min(limit, 200))
        .all();
}
