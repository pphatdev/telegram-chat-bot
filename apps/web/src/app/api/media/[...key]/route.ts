import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { getDbAsync } from "@/db/context";
import { isMediaKey } from "@telegram-bot/shared/r2/keys";
import { createD1AnonRateLimitStore } from "@telegram-bot/shared/rate-limit/anon-d1-store";
import { consume } from "@telegram-bot/shared/rate-limit/token-bucket";

/**
 * GET /api/media/{media/<botId>/<uuid>.<ext>}
 *
 * Public streaming proxy for R2 media objects. Telegram fetches this URL
 * when we send photo/document/video/audio broadcasts, so it MUST be
 * publicly reachable and unauth'd.
 *
 * The catch-all `[...key]` segment lets us keep the R2 key's `/` separators
 * in the URL — cleaner than base64-encoding on write.
 *
 * Defense in depth:
 *   - `isMediaKey` shape-check rejects arbitrary bucket paths.
 *   - Per-IP token bucket (10 req/sec, burst 30) blunts enumeration
 *     attempts. Keys are opaque UUIDs so blind guessing is already
 *     computationally infeasible, but a limiter also stops scrapers from
 *     hammering us with known key sets.
 *   - Only GET/HEAD are handled; POST/PUT/DELETE return 405.
 *   - No listing endpoint exists — enumeration requires a valid UUID guess.
 *
 * We set a long immutable Cache-Control because keys are UUIDs and objects
 * are never mutated in place.
 */

const MEDIA_RATE_LIMIT = { capacity: 30, refillPerSecond: 10 } as const;

/**
 * Consume one token from the per-IP media bucket. Returns null when the
 * request should proceed, or a 429 Response with `Retry-After` when the
 * bucket is empty.
 */
async function checkMediaRateLimit(request: Request): Promise<Response | null> {
    // CF-Connecting-IP is populated on Cloudflare; fall back to a coarse
    // sentinel so misconfigured local setups don't silently share a bucket.
    const ip = request.headers.get("cf-connecting-ip")
        ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? "unknown";
    const db = await getDbAsync();
    const store = createD1AnonRateLimitStore(db);
    const result = await consume(store, `media:${ip}`, MEDIA_RATE_LIMIT);
    if (result.allowed) return null;
    return new NextResponse("Too many requests", {
        status: 429,
        headers: {
            "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
        },
    });
}

export async function GET(
    request: Request,
    ctx: { params: Promise<{ key: string[] }> },
) {
    const throttled = await checkMediaRateLimit(request);
    if (throttled) return throttled;

    const { key: keyParts } = await ctx.params;
    const key = keyParts.join("/");

    if (!isMediaKey(key)) {
        return new NextResponse("Not found", { status: 404 });
    }

    const { env } = await getCloudflareContext({ async: true });
    const object = await env.R2.get(key);
    if (!object) {
        return new NextResponse("Not found", { status: 404 });
    }

    const headers = new Headers();
    if (object.httpMetadata?.contentType) {
        headers.set("Content-Type", object.httpMetadata.contentType);
    }
    headers.set("Content-Length", String(object.size));
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new Response(object.body, { status: 200, headers });
}

export async function HEAD(
    request: Request,
    ctx: { params: Promise<{ key: string[] }> },
) {
    const throttled = await checkMediaRateLimit(request);
    if (throttled) return throttled;

    const { key: keyParts } = await ctx.params;
    const key = keyParts.join("/");
    if (!isMediaKey(key)) return new NextResponse(null, { status: 404 });

    const { env } = await getCloudflareContext({ async: true });
    const object = await env.R2.head(key);
    if (!object) return new NextResponse(null, { status: 404 });

    const headers = new Headers();
    if (object.httpMetadata?.contentType) {
        headers.set("Content-Type", object.httpMetadata.contentType);
    }
    headers.set("Content-Length", String(object.size));
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new NextResponse(null, { status: 200, headers });
}
