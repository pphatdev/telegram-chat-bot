#!/usr/bin/env node
/**
 * Patches OpenNext's generated worker for realtime support.
 *
 * WHAT & WHY
 *   OpenNext (v1.20) compiles the Next.js app to `.open-next/worker.js` and:
 *     - only re-exports its own DOs (queue/tag-cache/bucket-cache), so
 *       Cloudflare rejects any user-defined DO binding referenced in
 *       wrangler.jsonc with "no such class exported";
 *     - reconstructs Responses on the way out of the route pipeline,
 *       dropping the Cloudflare-specific `webSocket` property. That means
 *       returning a WS-upgrade Response from a Next.js route silently
 *       breaks the handshake.
 *
 *   This script fixes both:
 *     1. Compile the ChatFeedHub DO to a sibling bundle and append
 *        `export { ChatFeedHub } from ...` to worker.js.
 *     2. Compile the chat-feed router to a sibling bundle, then wrap
 *        worker.js's `export default {...}` — the wrapper intercepts
 *        WebSocket upgrades to `/api/chat-feed` at the worker's entry point
 *        (before Next.js sees them) and delegates everything else back to
 *        OpenNext's original handler.
 *
 *   Idempotent — safe to run multiple times.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const WORKER_PATH = resolve(".open-next/worker.js");

const DURABLE_OBJECTS = [
    {
        exportName: "ChatFeedHub",
        source: "src/lib/realtime/chat-feed-hub.ts",
        outFile: ".open-next/durable-objects/chat-feed-hub.js",
    },
];

const ROUTER = {
    source: "src/lib/realtime/chat-feed-router.ts",
    outFile: ".open-next/durable-objects/chat-feed-router.js",
    importSpecifier: "./durable-objects/chat-feed-router.js",
    exportName: "routeChatFeed",
};

const WRAPPER_MARKER = "// __opennextjs_chat_feed_wrapped__";

if (!existsSync(WORKER_PATH)) {
    console.error(
        `[patch-open-next-worker] ${WORKER_PATH} not found. Run \`opennextjs-cloudflare build\` first.`,
    );
    process.exit(1);
}

let workerSrc = readFileSync(WORKER_PATH, "utf8");

// --- 1. Compile + export each DO class ------------------------------------
for (const { exportName, source, outFile } of DURABLE_OBJECTS) {
    await compileBundle(source, outFile);

    const importSpecifier = `./${outFile.replace(/^\.open-next\//, "").replace(/\\/g, "/")}`;
    const line = `export { ${exportName} } from "${importSpecifier}";`;

    if (workerSrc.includes(line)) {
        console.log(`[patch-open-next-worker] ${exportName} already exported. Skipping.`);
        continue;
    }
    if (workerSrc.includes(`export { ${exportName} }`)) {
        console.log(
            `[patch-open-next-worker] ${exportName} exported from a different path — leaving as-is.`,
        );
        continue;
    }

    workerSrc += `\n${line}\n`;
    console.log(`[patch-open-next-worker] Appended export for ${exportName}.`);
}

// --- 2. Compile router + wrap default export ------------------------------
await compileBundle(ROUTER.source, ROUTER.outFile);

if (workerSrc.includes(WRAPPER_MARKER)) {
    console.log("[patch-open-next-worker] Default export already wrapped. Skipping.");
} else {
    // The OpenNext template emits `export default {\n    async fetch...`.
    // We rebind that object literal to a const, then re-export a wrapper.
    const defaultExportRegex = /export\s+default\s+\{/;
    if (!defaultExportRegex.test(workerSrc)) {
        console.error(
            "[patch-open-next-worker] Could not locate `export default {` in worker.js. " +
                "OpenNext's template may have changed — patch script needs an update.",
        );
        process.exit(1);
    }

    workerSrc = workerSrc.replace(defaultExportRegex, "const __opennextDefault = {");

    workerSrc += `\n${WRAPPER_MARKER}
import { ${ROUTER.exportName} as __routeChatFeed } from "${ROUTER.importSpecifier}";
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (
            url.pathname === "/api/chat-feed" &&
            request.headers.get("upgrade")?.toLowerCase() === "websocket"
        ) {
            return __routeChatFeed(request, env);
        }
        return __opennextDefault.fetch(request, env, ctx);
    },
};
`;
    console.log("[patch-open-next-worker] Wrapped default export with WS interceptor.");
}

writeFileSync(WORKER_PATH, workerSrc, "utf8");

// --- helpers --------------------------------------------------------------
function compileBundle(source, outFile) {
    const srcPath = resolve(source);
    const outPath = resolve(outFile);

    if (!existsSync(srcPath)) {
        console.error(`[patch-open-next-worker] Source not found: ${srcPath}`);
        process.exit(1);
    }

    mkdirSync(dirname(outPath), { recursive: true });
    return build({
        entryPoints: [srcPath],
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        outfile: outPath,
        // workerd resolves these natively; leave them out of the bundle.
        external: ["cloudflare:workers"],
        logLevel: "warning",
    });
}
