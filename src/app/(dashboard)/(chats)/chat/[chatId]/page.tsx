import { notFound, redirect } from "next/navigation";
import { ChatPane } from "@/features/chats/components/chat-pane";
import { markChatAsRead } from "@/features/chats/actions";
import { getChatById, getMessagesForChat } from "@/features/chats/queries";
import { readSession } from "@/lib/auth/session";

/**
 * `/chat/[chatId]` — a single conversation, server-rendered.
 *
 * The chat row + first page of messages are fetched on the server so the
 * bubbles are present in the initial HTML (no client-side loading spinner
 * on navigation, better LCP, correct SSR of message content for share
 * previews / accessibility).
 *
 * Ownership is verified via `getChatById` scoped to the session's bot;
 * anything unowned or nonexistent returns 404 rather than leaking existence.
 * The read receipt is fire-and-forget — the response never waits on it.
 */
const PAGE_SIZE = 50;

interface ChatRoutePageProps {
    params: Promise<{ chatId: string }>;
}

export default async function ChatRoutePage({ params }: ChatRoutePageProps) {
    const session = await readSession();
    if (!session) redirect("/login");

    const { chatId: chatIdParam } = await params;
    const chatId = Number.parseInt(chatIdParam, 10);
    if (!Number.isFinite(chatId) || chatId <= 0) notFound();

    const chat = await getChatById(session.botId, chatId);
    if (!chat) notFound();

    // Fire-and-forget: clear the unread badge server-side. We don't await —
    // the user has already seen the thread by the time the badge would
    // matter, and a slow write path shouldn't stall the RSC response.
    void markChatAsRead(chat.id);

    const rows = await getMessagesForChat(chat.id, { limit: PAGE_SIZE });
    return (
        <ChatPane
            chat={chat}
            initialMessages={rows}
            initialCanLoadMore={rows.length === PAGE_SIZE}
        />
    );
}
