"use client";

import { useState } from "react";

interface AvatarImageProps {
    /** Full URL to the avatar proxy, e.g. /api/avatar/chat/123. */
    src: string;
    alt: string;
    /**
     * Rendered when the image fails to load OR while it's loading. Typically
     * a colored-initials `<span>` — passed as children so callers can reuse
     * their existing styling without prop drilling.
     */
    fallback: React.ReactNode;
    /** Sizing/positioning wrapper classes (must include a size + rounded). */
    className?: string;
}

/**
 * Avatar `<img>` overlay with a stateful fallback.
 *
 * The fallback is always rendered underneath; the img is layered on top with
 * `absolute inset-0` and unmounts on load-error or when the proxy returned
 * the 1×1 transparent PNG (target has no photo). That way the reader always
 * sees *something* — either the real photo, or the colored initials — and
 * never the broken-image glyph.
 *
 * We keep the fallback visible during load too, so the switch from initials
 * → photo happens naturally as the fetch completes rather than showing a
 * blank tile.
 */
export function AvatarImage({ src, alt, fallback, className = "" }: AvatarImageProps) {
    const [failed, setFailed] = useState(false);
    const [loaded, setLoaded] = useState(false);

    return (
        <span className={`relative overflow-hidden ${className}`}>
            {fallback}
            {!failed && (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailed(true)}
                    onLoad={(e) => {
                        // 1×1 fallback means the target has no photo — hide.
                        const img = e.currentTarget;
                        if (img.naturalWidth <= 1 || img.naturalHeight <= 1) {
                            setFailed(true);
                            return;
                        }
                        setLoaded(true);
                    }}
                    className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
                />
            )}
        </span>
    );
}
