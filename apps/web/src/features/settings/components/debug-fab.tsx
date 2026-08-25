"use client";

import { Bug, X } from "lucide-react";

interface DebugFabProps {
    enabled: boolean;
    /** When true, render the "close" state (X icon) instead of the Bug icon. */
    active?: boolean;
    onClick: () => void;
}

/**
 * Floating access button for the Debug Test panel.
 *
 * Only rendered when the signed-in user has `debug_enabled=true` — it's a
 * shortcut for operators actively debugging a bot, not a permanent chrome
 * fixture. Positioned bottom-right at a small footprint so it doesn't
 * fight the chat composer's Send button on mobile.
 *
 * `active` swaps the Bug glyph for an X so the FAB doubles as a "close
 * panel" affordance while the panel is open.
 */
export function DebugFab({ enabled, active, onClick }: DebugFabProps) {
    if (!enabled) return null;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={active ? "Close debug console" : "Open debug console"}
            aria-pressed={active}
            title={active ? "Close debug console" : "Debug console"}
            className={`fixed bottom-4 right-4 z-50 group flex items-center gap-2 rounded-full h-11 px-3.5 backdrop-blur-xl border transition-all active:scale-95 shadow-[0_8px_24px_rgba(245,158,11,0.35),0_2px_8px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.25)] ${
                active
                    ? "bg-amber-600/90 border-amber-500/50 text-white hover:bg-amber-600"
                    : "bg-amber-500/90 border-amber-400/40 text-white hover:bg-amber-500"
            }`}
        >
            <span className="grid size-6 place-items-center rounded-full bg-white/15 backdrop-blur-sm">
                {active ? <X className="w-3.5 h-3.5" /> : <Bug className="w-3.5 h-3.5" />}
            </span>
            <span className={`text-[13px] font-medium tracking-tight pr-1 overflow-hidden whitespace-nowrap transition-all duration-300 ${
                active ? "max-w-[60px] opacity-100" : "max-w-0 opacity-0 group-hover:max-w-[60px] group-hover:opacity-100"
            }`}>
                {active ? "Close" : "Debug"}
            </span>
            {!active && (
                <span className="pointer-events-none absolute -top-1 -right-1 size-2.5 rounded-full bg-emerald-400 border border-background shadow-sm" aria-hidden />
            )}
        </button>
    );
}
