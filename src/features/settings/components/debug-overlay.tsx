"use client";

import { useEffect, useState } from "react";
import { loadDebugEnabled } from "@/features/settings/actions";
import { DebugFab } from "./debug-fab";
import { DebugTestPanel } from "./debug-test-panel";

/**
 * Event dispatched from SettingsModal after the debug-logging flag is
 * successfully toggled. Listening for this in the overlay keeps state
 * in sync without threading a prop through the navigation sidebar (which
 * doesn't own debug diagnostics — it's a dashboard-level concern).
 */
export const DEBUG_TOGGLE_EVENT = "telegram-bot:debug-toggled";

export interface DebugToggleEventDetail {
    enabled: boolean;
}

/**
 * Dashboard-level debug surface: the floating FAB + the right-side test
 * panel it opens. Mounted from `app/(dashboard)/layout.tsx` so every route
 * under the dashboard shares one instance — the FAB is a global operator
 * tool, not a sidebar affordance.
 *
 * Renders nothing when the signed-in user has `debug_enabled=false`; the
 * FAB and panel appear the moment the flag flips on (via the custom event
 * dispatched from SettingsModal) and disappear the moment it flips off.
 */
export function DebugOverlay() {
    const [enabled, setEnabled] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);

    // Initial load — one round-trip on mount.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const result = await loadDebugEnabled();
            if (!cancelled && result.ok) setEnabled(result.data.enabled);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Subscribe to Settings toggle events. Same-tab only — a toggle in a
    // second tab would need a BroadcastChannel or polling, out of scope for
    // this diagnostic-only feature.
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<DebugToggleEventDetail>).detail;
            if (typeof detail?.enabled === "boolean") {
                setEnabled(detail.enabled);
            }
        };
        window.addEventListener(DEBUG_TOGGLE_EVENT, handler);
        return () => window.removeEventListener(DEBUG_TOGGLE_EVENT, handler);
    }, []);

    // Close the panel automatically when debug is disabled so re-enabling
    // doesn't spuriously auto-open it later.
    useEffect(() => {
        if (!enabled) setPanelOpen(false);
    }, [enabled]);

    return (
        <>
            <DebugFab
                enabled={enabled && !panelOpen}
                onClick={() => setPanelOpen(true)}
            />
            <DebugTestPanel
                open={enabled && panelOpen}
                onClose={() => setPanelOpen(false)}
            />
        </>
    );
}
