import { and, desc, eq } from "drizzle-orm";
import { getDbAsync } from "@/db/context";
import {
    broadcastTargets,
    broadcasts,
    chats,
    type BroadcastRow,
    type BroadcastTargetRow,
    type ChatRow,
} from "@telegram-bot/shared/db/schema";

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

export interface BroadcastTargetView extends BroadcastTargetRow {
    chatTitle: string;
    chatUsername: string | null;
}

/**
 * Per-target delivery ledger for a broadcast, joined against the chats table
 * so the UI can render human-readable names without a second round-trip.
 * Constrained to a bot to prevent cross-tenant reads via a guessed broadcast
 * id — callers pass `botId` from the session.
 */
export async function getBroadcastTargets(
    botId: number,
    broadcastId: number,
): Promise<BroadcastTargetView[]> {
    const db = await getDbAsync();
    const rows = await db
        .select({ target: broadcastTargets, chat: chats, broadcastBotId: broadcasts.botId })
        .from(broadcastTargets)
        .innerJoin(broadcasts, eq(broadcasts.id, broadcastTargets.broadcastId))
        .innerJoin(chats, eq(chats.id, broadcastTargets.chatId))
        .where(and(eq(broadcastTargets.broadcastId, broadcastId), eq(broadcasts.botId, botId)))
        .orderBy(desc(broadcastTargets.createdAt))
        .all();

    return rows.map(({ target, chat }: { target: BroadcastTargetRow; chat: ChatRow }) => ({
        ...target,
        chatTitle: chat.title,
        chatUsername: chat.username,
    }));
}
