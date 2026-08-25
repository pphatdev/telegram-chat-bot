import { redirect } from "next/navigation";
import { BroadcastHistory } from "@/features/broadcast/components/broadcast-history";
import { getBroadcastsForBot } from "@/features/broadcast/queries";
import { readSession } from "@/lib/auth/session";

/**
 * /broadcasts — Broadcast history view.
 *
 * Server component: reads the session, pulls the last 50 broadcasts for the
 * active bot, and hands them to the interactive `<BroadcastHistory>` client
 * which drives Cancel / Send-Now actions.
 *
 * Middleware.ts guards unauthenticated access; the redirect below is
 * belt-and-suspenders for mid-request cookie expiry.
 */
export default async function BroadcastsPage() {
    const session = await readSession();
    if (!session) redirect("/login");
    const rows = await getBroadcastsForBot(session.botId, 50);
    return <BroadcastHistory initial={rows} />;
}
