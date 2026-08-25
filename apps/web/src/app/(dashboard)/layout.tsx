import type { ReactNode } from "react";
import { DebugOverlay } from "@/features/settings/components/debug-overlay";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Dashboard shell — hosts every authenticated route under `(dashboard)`.
 *
 * Kept minimal on purpose: page-level shells (ChatFrame, BroadcastHistory)
 * own their own layout. This wrapper:
 *   - Wraps everything in `TooltipProvider delay={0}` so all Base UI
 *     tooltips (Reply, Send, sidebar affordances) open on hover instead
 *     of waiting the default ~600 ms delay.
 *   - Injects the global debug overlay so the FAB + test panel sit above
 *     every dashboard surface without any page needing to opt in.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <TooltipProvider delay={0}>
            {children}
            <DebugOverlay />
        </TooltipProvider>
    );
}
