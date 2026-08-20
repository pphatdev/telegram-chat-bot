import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest configuration.
 *
 * Node environment is intentional: the code under test in this pass is
 * pure logic (crypto helpers, Zod schemas, token-bucket algorithm). Node 20+
 * ships Web Crypto (SubtleCrypto) globally, so `src/lib/crypto/*` works
 * without any polyfill.
 *
 * Server actions, D1-backed stores, and route handlers need workerd-runtime
 * tests — plan is to add `@cloudflare/vitest-pool-workers` as a second
 * project when we tackle those.
 */
export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        globals: false,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});
