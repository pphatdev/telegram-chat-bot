import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Root Vitest config for the monorepo.
 *
 * Node environment is intentional: the current test surface is pure logic
 * (crypto helpers, Zod schemas, token-bucket algorithm) — Node 20+ ships Web
 * Crypto (SubtleCrypto) globally, so `packages/shared/src/crypto/*` works
 * without any polyfill.
 *
 * Server actions, D1-backed stores, and route handlers need workerd-runtime
 * tests — plan is to add `@cloudflare/vitest-pool-workers` as a second
 * project when we tackle those.
 */
export default defineConfig({
    test: {
        environment: "node",
        include: [
            "packages/*/src/**/*.test.ts",
            "apps/*/src/**/*.test.ts",
        ],
        globals: false,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./apps/web/src"),
            "@telegram-bot/shared": path.resolve(__dirname, "./packages/shared/src"),
        },
    },
});
