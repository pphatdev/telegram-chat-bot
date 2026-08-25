/**
 * Empty-state pane rendered at `/` (no chat selected).
 *
 * Kept trivial — the sidebar owns all conversational affordances. On mobile
 * this pane is hidden entirely (the sidebar covers the viewport); on lg+ it
 * sits alongside the sidebar with a centered "Select a chat" pill so the
 * primary surface isn't a blank void.
 *
 * The pane matches the visual footprint of `<ChatPane>` (rounded glass
 * panel, same negative-space allocation) so navigating to and from a chat
 * doesn't produce a layout jump.
 */
export function EmptyChatPane() {
    return (
        <section className="hidden lg:flex bg-background/40 backdrop-blur-3xl rounded-[32px] shadow-[0_30px_60px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.1)_inset,0_2px_12px_rgba(255,255,255,0.2)_inset] min-w-93.75 flex-1 flex-col overflow-hidden relative">
            <div className="flex flex-1 items-center justify-center relative z-10">
                <div className="bg-black/5 dark:bg-white/5 backdrop-blur-md rounded-full px-6 py-2 text-[14px] font-medium text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.02)_inset] border border-white/10">
                    Select a chat to start messaging
                </div>
            </div>
        </section>
    );
}
