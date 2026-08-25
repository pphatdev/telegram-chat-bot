"use client";

import { useState, useEffect, useCallback } from "react";
import { Lock, Delete, Fingerprint } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface PasscodeLockProps {
    onUnlock: () => void;
    correctPasscode?: string;
}

/**
 * Full-screen lock overlay triggered by Ctrl/Cmd+L.
 *
 * Wrapped in Base UI Dialog with `dismissible={false}` so Escape and outside
 * clicks cannot bypass the lock. Dialog gives us focus trap + aria-modal
 * semantics for free.
 */
export function PasscodeLock({ onUnlock, correctPasscode = "1234" }: PasscodeLockProps) {
    const [passcode, setPasscode] = useState("");
    const [error, setError] = useState(false);
    const [shaking, setShaking] = useState(false);

    const handleNumberClick = useCallback((num: string) => {
        setPasscode((prev) => (prev.length < 4 ? prev + num : prev));
        setError(false);
    }, []);

    const handleDelete = useCallback(() => {
        setPasscode((prev) => prev.slice(0, -1));
        setError(false);
    }, []);

    useEffect(() => {
        if (passcode.length !== 4) return;
        if (passcode === correctPasscode) {
            setTimeout(() => onUnlock(), 200);
        } else {
            setError(true);
            setShaking(true);
            setTimeout(() => {
                setShaking(false);
                setPasscode("");
                setError(false);
            }, 500);
        }
    }, [passcode, correctPasscode, onUnlock]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key >= "0" && e.key <= "9") {
                handleNumberClick(e.key);
            } else if (e.key === "Backspace") {
                handleDelete();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleNumberClick, handleDelete]);

    return (
        <Dialog open onOpenChange={() => { /* lock: ignore all dismissal attempts */ }}>
            <DialogContent
                showCloseButton={false}
                aria-label="Enter passcode to unlock"
                onKeyDown={(e) => {
                    // Prevent Escape from bubbling out and being treated as dismiss.
                    if (e.key === "Escape") e.stopPropagation();
                }}
                className="fixed inset-0 top-0 left-0 z-100 w-full h-full max-w-none translate-x-0 translate-y-0 rounded-none bg-background/80 backdrop-blur-2xl ring-0 p-0 flex flex-col items-center justify-center"
            >
                <div className={cn("flex flex-col items-center max-w-sm w-full px-8", shaking && "animate-shake")}>
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(13,148,136,0.2)] dark:shadow-[0_0_40px_rgba(13,148,136,0.1)]">
                        <Lock className="w-8 h-8 text-primary" />
                    </div>

                    <h2 className="text-[22px] font-semibold mb-2 tracking-tight text-foreground">Enter Passcode</h2>
                    <p className="text-muted-foreground text-[15px] mb-12 h-5">
                        {error ? <span className="text-destructive font-medium">Incorrect passcode</span> : "Please enter your passcode"}
                    </p>

                    <div className="flex gap-5 mb-16 h-4 items-center">
                        {[0, 1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className={cn(
                                    "w-3.5 h-3.5 rounded-full transition-all duration-200",
                                    passcode.length > i ? "bg-primary scale-110" : "bg-primary/20 scale-100",
                                    error && passcode.length > i && "bg-destructive",
                                )}
                            />
                        ))}
                    </div>

                    <div className="grid grid-cols-3 gap-x-12 gap-y-6 w-full max-w-70">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                            <button
                                key={num}
                                onClick={() => handleNumberClick(num.toString())}
                                className="w-16 h-16 rounded-full flex items-center justify-center text-[28px] font-light hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors mx-auto text-foreground"
                            >
                                {num}
                            </button>
                        ))}
                        <button
                            className="w-16 h-16 rounded-full flex items-center justify-center hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors mx-auto text-primary"
                            aria-label="Unlock with biometrics"
                        >
                            <Fingerprint className="w-7 h-7" />
                        </button>
                        <button
                            onClick={() => handleNumberClick("0")}
                            className="w-16 h-16 rounded-full flex items-center justify-center text-[28px] font-light hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors mx-auto text-foreground"
                        >
                            0
                        </button>
                        <button
                            onClick={handleDelete}
                            aria-label="Delete last digit"
                            className="w-16 h-16 rounded-full flex items-center justify-center hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors mx-auto text-foreground"
                        >
                            <Delete className="w-7 h-7" />
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
