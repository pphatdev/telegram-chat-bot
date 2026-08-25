import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Edge middleware — cheap routing guard for the dashboard.
 *
 * We only check that a session cookie is *present* here. Full HMAC
 * verification lives in the server components under `(dashboard)/` (they call
 * `readSession()` and redirect on failure), which is where D1 access and
 * `getCloudflareContext` are reliably available.
 *
 * Keeping middleware crypto-free avoids two problems:
 *   1. `getCloudflareContext` isn't wired into Next 16 + Turbopack's
 *      middleware runtime, so touching env bindings here throws at dev time.
 *   2. Middleware runs on every guarded request; skipping HMAC on obviously
 *      anonymous traffic saves work.
 *
 * A forged/expired cookie still passes middleware, but the page-level
 * `readSession()` call rejects it before any authenticated data is read.
 */
export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match everything EXCEPT auth pages, API routes, static assets, favicon,
  // and Next's internal RSC/prefetch endpoints. The `(dashboard)` group has
  // no path segment of its own, so its routes surface at bare `/*`.
  matcher: [
    "/((?!login|signup|api/telegram|api/cron|api/media|_next/static|_next/image|favicon.ico).*)",
  ],
};
