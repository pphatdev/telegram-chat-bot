import { EmptyChatPane } from "@/features/chats/components/empty-chat-pane";

/**
 * Dashboard root (`/`) — no chat selected.
 *
 * Renders the empty pane on the right of the sidebar. All the chat-list
 * data + sidebar visibility live one level up in `(chats)/layout.tsx`, so
 * this file is intentionally trivial. On mobile the sidebar covers the
 * pane; on lg+ the pane sits alongside it with the "Select a chat" pill.
 */
export default function DashboardIndexPage() {
    return <EmptyChatPane />;
}
