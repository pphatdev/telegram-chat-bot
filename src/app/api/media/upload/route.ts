import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { MediaUploadError, putMediaObject, type MediaKind } from "@/lib/r2";

/**
 * POST /api/media/upload
 *
 * Session-guarded media upload for the composer + broadcast composer.
 * Accepts multipart/form-data with:
 *   - `file` (required): the Blob to store
 *   - `kind` (optional): "photo" | "video" | "audio" | "document" — hint
 *     that lets the caller distinguish "sendPhoto with compression" from
 *     "sendDocument as-is" for the same underlying JPG.
 *
 * Returns { ok, r2Key, mimeType, size, kind } on success.
 *
 * Note: streams into R2 via `file.stream()` — the whole file still hits the
 * Worker request buffer, so callers should chunk large uploads with resumable
 * URLs when we cross ~50 MB. For now the per-kind cap in MEDIA_LIMITS
 * keeps every request under the Workers 100 MB request limit.
 */
export async function POST(request: Request) {
    const session = await readSession();
    if (!session) {
        return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return NextResponse.json({ ok: false, error: "bad_form_data" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof Blob)) {
        return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
    }

    const rawKind = formData.get("kind");
    const kind = isMediaKind(rawKind) ? rawKind : undefined;

    try {
        const uploaded = await putMediaObject(session.botId, file, kind);
        return NextResponse.json({ ok: true, ...uploaded });
    } catch (err) {
        if (err instanceof MediaUploadError) {
            const status = err.code === "too_large" ? 413 : err.code === "put_failed" ? 502 : 400;
            return NextResponse.json({ ok: false, error: err.code, description: err.message }, { status });
        }
        return NextResponse.json(
            { ok: false, error: "internal", description: err instanceof Error ? err.message : "unknown" },
            { status: 500 },
        );
    }
}

export function GET() {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}

function isMediaKind(v: unknown): v is MediaKind {
    return v === "photo" || v === "video" || v === "audio" || v === "document";
}
