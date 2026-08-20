import { redirect } from "next/navigation";
import { ChatShell } from "@/features/chats/components/chat-shell";
import { getChatsForBot } from "@/features/chats/queries";
import { readSession } from "@/lib/auth/session";

/**
 * Dashboard entrypoint.
 *
 * Server component: reads the session cookie, pulls the sidebar chat list
 * for the active bot from D1, and hands it to the interactive `<ChatShell>`
 * client component.
 *
 * Middleware.ts already redirects unauthenticated requests to /login, so a
 * missing session here would only happen mid-request (e.g. cookie expired
 * during navigation) — we redirect defensively.
 */
export default async function DashboardPage() {
    const session = await readSession();
    if (!session) redirect("/login");

    const chats = await getChatsForBot(session.botId);
    return <ChatShell initialChats={chats} />;
}
