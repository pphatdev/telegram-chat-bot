import { redirect } from "next/navigation";
import { ChatFrame } from "@/features/chats/components/chat-frame";
import { getChatsForBot } from "@/features/chats/queries";
import { readSession } from "@/lib/auth/session";

/**
 * `(chats)` route group layout.
 *
 * The route group is invisible in URLs — its children surface at bare `/`
 * (empty pane) and `/chat/[chatId]` (specific thread). Both share this
 * layout so the sidebar + resizer + lock overlay + ambient background render
 * once and children hot-swap the right-hand pane on navigation.
 *
 * Server-fetches the sidebar chats once per navigation to this layout
 * (Next 16 will de-dupe if the same layout re-renders for a segment change);
 * ChatFrame seeds its client state from these initial rows and keeps them
 * fresh via `useChatFeed` + `refreshChats`.
 *
 * Middleware.ts blocks unauthenticated traffic; the redirect below is
 * belt-and-suspenders for mid-request cookie expiry.
 */
export default async function ChatsLayout({ children }: { children: React.ReactNode }) {
    const session = await readSession();
    if (!session) redirect("/login");

    const chats = await getChatsForBot(session.botId);
    return <ChatFrame initialChats={chats}>{children}</ChatFrame>;
}
