import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { isMediaKey } from "@/lib/r2/keys";

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
 *   - Only GET/HEAD are handled; POST/PUT/DELETE return 405.
 *   - No listing endpoint exists — enumeration requires a valid UUID guess.
 *
 * We set a long immutable Cache-Control because keys are UUIDs and objects
 * are never mutated in place.
 */
export async function GET(
    _request: Request,
    ctx: { params: Promise<{ key: string[] }> },
) {
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
    _request: Request,
    ctx: { params: Promise<{ key: string[] }> },
) {
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
