# TODO — Continuing Recent Work

Snapshot: 2026-08-24 · branch `develop` (1 commit behind `origin/develop`)

## 0. Sync before starting

- [x] `git pull --ff-only origin develop` — done 2026-08-24 (README update only)
- [x] `pnpm install` — 4 workspace projects hydrated
- [x] `pnpm typecheck` — green (typegen + per-workspace tsc via `-r --if-present run typecheck`)
- [x] `pnpm test` — 65/65 pass

## 1. Monorepo restructure (in-progress, uncommitted)

Root reshaped into `apps/web` + `apps/bot-api` + `packages/shared` with pnpm workspaces. Rename set is staged; a large set of edits + new files is still unstaged/untracked.

### 1a. Untracked scaffolding that must land in the same commit as the renames
- [x] `pnpm-workspace.yaml` — present; also carries `verifyDepsBeforeRun: false` + `allowBuilds` policy
- [x] `pnpm-lock.yaml` — present
- [x] `tsconfig.base.json` — present
- [x] `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/cloudflare-env.d.ts`, `apps/web/src/db/` — present
- [x] `apps/bot-api/` — placeholder package.json only (Phase 3 — see §3)
- [x] `packages/shared/package.json` + `packages/shared/tsconfig.json` (added 2026-08-24)
- [x] `packages/shared/src/index.ts` + all sub-barrels verified

### 1b. Edits on top of the moved files (verify each)
- [x] `apps/web/next.config.ts` — has `transpilePackages: ["@telegram-bot/shared"]`
- [x] `apps/web/wrangler.jsonc` — bindings intact (build resolves them)
- [x] `apps/web/src/app/api/**` and `apps/web/src/features/**` — imports use `@telegram-bot/shared/*`; remaining `@/lib/...` / `@/db/context` are intentional OpenNext-bound wrappers that stay inside apps/web
- [x] `drizzle.config.ts` — points at `packages/shared/src/db/{schema,migrations}`
- [x] `vitest.config.ts` — aliases `@telegram-bot/shared` and `@` correctly
- [x] Root `tsconfig.json` — paths + excludes correct
- [x] `packages/shared/node_modules/` — .gitignore fixed (patterns no longer root-anchored)

### 1c. Verification gates before committing the restructure
- [x] `pnpm --filter @telegram-bot/web build` — succeeds (14 routes, 2 warnings: middleware→proxy deprecation, DO class-not-exported startup warning)
- [ ] `pnpm --filter @telegram-bot/web cf:build` — **CI-only.** Fails on Windows due to dir-symlink permissions in esbuild (`.open-next/server-functions/.../node_modules/.pnpm/next@.../node_modules/{react,react-dom,styled-jsx}`). Verify from a Linux CI runner or WSL.
- [ ] Preview boot + route render — blocked on cf:build; verify from CI/WSL
- [ ] Webhook `X-Telegram-Bot-Api-Secret-Token` validation still enforced — verify from preview once available
- [ ] Cron route `CRON_SECRET` gate still enforced — verify from preview once available

### 1d. Commit strategy
- [ ] One commit for the rename set (git already detects them as renames — keep it clean)
- [ ] Follow-up commit for import rewrites + workspace glue
- [ ] Third commit for `packages/shared` barrels and `apps/bot-api` scaffold if separable

## 2. `packages/shared` finishing touches

- [ ] Confirm every subpath listed in `packages/shared/package.json#exports` has a real file behind it
- [ ] Add a per-package `tsconfig.json` if missing (extends `tsconfig.base.json`, `composite: true` if we want project refs)
- [ ] Make sure crypto/rate-limit/schema tests still discover via root `vitest.config.ts`
- [ ] Decide whether `@cloudflare/workers-types` should be a peer dep (bot-api will also need it)

## 3. `apps/bot-api` — Phase 3 scaffold

Currently just a placeholder `package.json`. Recent work (webhook, cron, dispatcher, rate limiting, R2 avatars) is what this service will eventually own.

- [ ] Decide split: does `apps/web` keep the API routes for now, or do we start migrating `/api/telegram/webhook/[botId]`, `/api/cron/scheduled-broadcasts`, `/api/media/*` to `apps/bot-api`?
- [ ] Scaffold `wrangler.jsonc`, `src/index.ts` (Worker entry), `tsconfig.json`
- [ ] Wire bindings: `DB`, `R2`, `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`, `CRON_SECRET`
- [ ] Move (do not duplicate) the dispatcher + sweep + cron logic once contracts are stable
- [ ] Add a `dev` script and route both workers behind a single Wrangler dev config or `pnpm -r dev`

## 4. Follow-ups from recent feature commits

- [ ] `cfe58de` ChatFrame + SSR chat pages — audit `apps/web/src/app/(dashboard)/(chats)/chat/[chatId]/page.tsx` for correct data fetching under Edge; confirm no client-only imports leak into the server page
- [ ] `d33b3f0` reactions/passcode/debug server actions — verify Zod schemas on every action; ensure passcode action rate-limits attempts
- [ ] `0f878ab` realtime JSON probe — smoke-test dev WebSocket handshake still works cleanly after restructure
- [ ] `82c421e` chat background presets — per-conversation override persistence path survived the `features/settings` move

## 5. Housekeeping

- [ ] Delete/replace stale `_var` shims or re-exports created only to preserve old import paths
- [ ] Update `AGENTS.md` / `.agents/*` file-path references to point at `apps/web/src/features/...` and `packages/shared/src/...`
- [ ] Update `README.md` (if any) with the new `pnpm --filter` workflow
- [ ] `.gitignore` — ensure `packages/*/node_modules/`, `apps/*/.next/`, `apps/*/.open-next/`, `apps/*/.wrangler/` are covered
