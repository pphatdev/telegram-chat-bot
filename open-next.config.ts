import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext configuration for Cloudflare.
 *
 * incrementalCache is intentionally left at its default (in-memory). Every
 * dashboard page is session-guarded and hits D1 on each render (no
 * `revalidate`, no `generateStaticParams`, no ISR), so wiring an R2 cache
 * would just add a required binding for nothing. If you introduce ISR later,
 * re-import `r2IncrementalCache` here and add a `NEXT_INC_CACHE_R2_BUCKET`
 * R2 binding in wrangler.jsonc.
 */
export default defineCloudflareConfig({});
