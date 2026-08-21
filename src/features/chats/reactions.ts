import { z } from "zod";

/**
 * Persisted reaction shape stored in `messages.reactionsJson`.
 *
 * The array is small (Telegram caps at ~11 emoji per message) so we index
 * linearly rather than by key. Each entry can carry:
 *   - `count`: aggregate user reactions (populated from `message_reaction_count`
 *     webhook updates in a later batch — 0/undefined for now).
 *   - `byBot`: true when the bot itself has this reaction. Only ONE entry
 *     can have `byBot=true` — Bot API only allows a bot one reaction per
 *     message. We use it to highlight the bot's active reaction in the
 *     picker and to know what to remove on toggle.
 */
export const persistedReactionSchema = z.object({
    emoji: z.string().min(1).max(16),
    count: z.number().int().min(0).optional(),
    byBot: z.boolean().optional(),
});
export const persistedReactionsSchema = z.array(persistedReactionSchema).max(20);

export type PersistedReaction = z.infer<typeof persistedReactionSchema>;

/**
 * Parse the raw `reactionsJson` column safely. Never throws — a corrupted
 * row shouldn't crash the whole message list render.
 */
export function parseReactionsJson(raw: string | null): PersistedReaction[] {
    if (!raw) return [];
    try {
        const parsed = persistedReactionsSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : [];
    } catch {
        return [];
    }
}

export function serializeReactions(reactions: PersistedReaction[]): string {
    return JSON.stringify(reactions);
}

/**
 * Return the bot's current reaction emoji, or null when the bot hasn't
 * reacted. Convenience for the UI's picker highlight logic.
 */
export function botReaction(reactions: PersistedReaction[]): string | null {
    return reactions.find((r) => r.byBot)?.emoji ?? null;
}

/**
 * Apply the bot's next reaction to an existing list.
 *
 * Rules:
 *   - `nextEmoji === null` removes the bot's reaction entirely.
 *   - Setting the same emoji again is a no-op.
 *   - Setting a different emoji replaces the bot's slot; the old entry is
 *     dropped only if it has no user count (`count > 0` means users are
 *     also using it and we keep it in the aggregate view).
 */
export function applyBotReaction(
    reactions: PersistedReaction[],
    nextEmoji: string | null,
): PersistedReaction[] {
    const withoutBot = reactions.map((r) => (r.byBot ? { ...r, byBot: undefined } : r));
    const cleaned = withoutBot.filter((r) => (r.count ?? 0) > 0);

    if (!nextEmoji) return cleaned;

    const existing = cleaned.find((r) => r.emoji === nextEmoji);
    if (existing) {
        return cleaned.map((r) => (r.emoji === nextEmoji ? { ...r, byBot: true } : r));
    }
    return [...cleaned, { emoji: nextEmoji, byBot: true }];
}

/**
 * Canonical set of emoji reactions the Telegram Bot API accepts via
 * `setMessageReaction`. Sending anything else (or the "same" emoji with a
 * different code-point form) fails with `Bad Request: REACTION_INVALID`.
 *
 * Notes on the exact code points below:
 *   - Heart is `❤` (U+2764) with NO `U+FE0F` variation selector — Telegram
 *     rejects the VS16 form.
 *   - `🤣` is allowed; `😂` is not (subtle but strictly enforced).
 *   - Same for `🕊`, `⚡`, `❤‍🔥`, `☃`, `✍`, `🤷‍♂`, `🤷‍♀` — no VS16.
 *
 * All entries are written with explicit `\u` escapes rather than literal
 * glyphs — some of these characters (❤, ⚡, 🕊, ☃, ✍, ♂, ♀) have both a
 * text and an emoji presentation, and any editor that autoinjects U+FE0F
 * would silently break the allowlist. `‍` is the ZWJ used in combined
 * sequences (👨‍💻, ❤‍🔥, 🤷‍♂, 🤷‍♀).
 *
 * Kept as a Set for O(1) membership; the list mirrors the current allowlist
 * documented at https://core.telegram.org/bots/api#reactiontypeemoji.
 */
export const TELEGRAM_BOT_REACTION_EMOJIS = new Set<string>([
    "\u{1F44D}",                                     // 👍
    "\u{1F44E}",                                     // 👎
    "\u{2764}",                                      // ❤ (no VS16)
    "\u{1F525}",                                     // 🔥
    "\u{1F970}",                                     // 🥰
    "\u{1F44F}",                                     // 👏
    "\u{1F601}",                                     // 😁
    "\u{1F914}",                                     // 🤔
    "\u{1F92F}",                                     // 🤯
    "\u{1F631}",                                     // 😱
    "\u{1F92C}",                                     // 🤬
    "\u{1F622}",                                     // 😢
    "\u{1F389}",                                     // 🎉
    "\u{1F929}",                                     // 🤩
    "\u{1F92E}",                                     // 🤮
    "\u{1F4A9}",                                     // 💩
    "\u{1F64F}",                                     // 🙏
    "\u{1F44C}",                                     // 👌
    "\u{1F54A}",                                     // 🕊 (no VS16)
    "\u{1F921}",                                     // 🤡
    "\u{1F971}",                                     // 🥱
    "\u{1F974}",                                     // 🥴
    "\u{1F60D}",                                     // 😍
    "\u{1F433}",                                     // 🐳
    "\u{2764}\u{200D}\u{1F525}",                     // ❤‍🔥 (heart + ZWJ + fire, no VS16 on heart)
    "\u{1F31A}",                                     // 🌚
    "\u{1F32D}",                                     // 🌭
    "\u{1F4AF}",                                     // 💯
    "\u{1F923}",                                     // 🤣  (NOT 😂 U+1F602)
    "\u{26A1}",                                      // ⚡ (no VS16)
    "\u{1F34C}",                                     // 🍌
    "\u{1F3C6}",                                     // 🏆
    "\u{1F494}",                                     // 💔
    "\u{1F928}",                                     // 🤨
    "\u{1F610}",                                     // 😐
    "\u{1F353}",                                     // 🍓
    "\u{1F37E}",                                     // 🍾
    "\u{1F48B}",                                     // 💋
    "\u{1F595}",                                     // 🖕
    "\u{1F608}",                                     // 😈
    "\u{1F634}",                                     // 😴
    "\u{1F62D}",                                     // 😭
    "\u{1F913}",                                     // 🤓
    "\u{1F47B}",                                     // 👻
    "\u{1F468}\u{200D}\u{1F4BB}",                    // 👨‍💻
    "\u{1F440}",                                     // 👀
    "\u{1F383}",                                     // 🎃
    "\u{1F648}",                                     // 🙈
    "\u{1F607}",                                     // 😇
    "\u{1F628}",                                     // 😨
    "\u{1F91D}",                                     // 🤝
    "\u{270D}",                                      // ✍ (no VS16)
    "\u{1F917}",                                     // 🤗
    "\u{1FAE1}",                                     // 🫡
    "\u{1F385}",                                     // 🎅
    "\u{1F384}",                                     // 🎄
    "\u{2603}",                                      // ☃ (no VS16)
    "\u{1F485}",                                     // 💅
    "\u{1F92A}",                                     // 🤪
    "\u{1F5FF}",                                     // 🗿
    "\u{1F192}",                                     // 🆒
    "\u{1F498}",                                     // 💘
    "\u{1F649}",                                     // 🙉
    "\u{1F984}",                                     // 🦄
    "\u{1F618}",                                     // 😘
    "\u{1F48A}",                                     // 💊
    "\u{1F64A}",                                     // 🙊
    "\u{1F60E}",                                     // 😎
    "\u{1F47E}",                                     // 👾
    "\u{1F937}\u{200D}\u{2642}",                     // 🤷‍♂ (no VS16 on ♂)
    "\u{1F937}",                                     // 🤷
    "\u{1F937}\u{200D}\u{2640}",                     // 🤷‍♀ (no VS16 on ♀)
    "\u{1F621}",                                     // 😡
]);

/**
 * Normalize a user-picked emoji to the exact code-point form Telegram's
 * Bot API expects, or return `null` if the emoji isn't in the allowlist.
 *
 * The main normalization is stripping the `U+FE0F` variation selector —
 * many emoji keyboards emit `❤️` (with VS16) but Telegram rejects it and
 * expects `❤` alone. Same for `🕊`, `⚡`, `☃`, `✍`, and the ZWJ sequences.
 */
export function normalizeReactionEmoji(raw: string): string | null {
    if (!raw) return null;
    // Strip U+FE0F (VARIATION SELECTOR-16 / VS16). Written as a `\u` escape
    // in the regex source so future readers can see the target char (the
    // literal is invisible and easily mistaken for a stray backslash).
    const stripped = raw.replace(/️/g, "");
    return TELEGRAM_BOT_REACTION_EMOJIS.has(stripped) ? stripped : null;
}
