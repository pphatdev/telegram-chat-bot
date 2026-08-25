import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Expose Cloudflare bindings (env.DB, env.R2, env.TELEGRAM_BOT_TOKEN, etc.)
// to `next dev` via getCloudflareContext(). Must run before the config export
// so middleware evaluated during dev startup can resolve env bindings.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Consume the workspace shared package as source (no dist/ build step).
  transpilePackages: ["@telegram-bot/shared"],
};

export default nextConfig;
