/**
 * Chat conversation background presets.
 *
 * Consumed by `chat-pane.tsx` via two CSS custom properties
 * (`--chat-bg-color`, `--chat-bg-image`) set on `documentElement`. Persisted
 * in `localStorage` under `CHAT_BG_STORAGE_KEY`. Presets use OKLCH with low
 * alpha so they read correctly against both light and dark themes without
 * a second dark-mode variant.
 */

export type ChatBackground =
  | { kind: "color"; id: string }
  | { kind: "image"; id: string }
  | { kind: "url"; url: string };

export interface ChatBgPreset {
  id: string;
  label: string;
  /** Value for `background-image` (image presets) or `background-color`
   *  (color presets). Must be a single valid value for the target property —
   *  do NOT include position/size shorthand pieces here (those go in `size`
   *  and `repeat`). */
  css: string;
  /** Override for `background-size`. Defaults to `cover`. Tileable patterns
   *  (e.g. dots) should set a fixed tile size like `18px 18px`. */
  size?: string;
  /** Override for `background-repeat`. Defaults to `no-repeat`. Tileable
   *  patterns should set `repeat`. */
  repeat?: string;
}

export const CHAT_BG_STORAGE_KEY = "chat-bg";

/** Storage key for a chat's per-conversation background override. Missing
 *  key means "use the global default" (see `resolveChatBackground`). */
const perChatKey = (chatId: number) => `chat-bg:${chatId}`;

export const DEFAULT_CHAT_BG: ChatBackground = { kind: "color", id: "default" };

export const CHAT_BG_COLORS: ChatBgPreset[] = [
  { id: "default", label: "Default", css: "transparent" },
  { id: "teal", label: "Teal", css: "oklch(70% 0.12 195 / 0.18)" },
  { id: "sky", label: "Sky", css: "oklch(70% 0.14 245 / 0.18)" },
  { id: "violet", label: "Violet", css: "oklch(65% 0.20 305 / 0.15)" },
  { id: "rose", label: "Rose", css: "oklch(70% 0.18 15 / 0.15)" },
  { id: "amber", label: "Amber", css: "oklch(78% 0.15 75 / 0.18)" },
];

export const CHAT_BG_IMAGES: ChatBgPreset[] = [
  {
    id: "aurora",
    label: "Aurora",
    css: "linear-gradient(135deg, oklch(70% 0.15 195/0.30), oklch(65% 0.20 285/0.30), oklch(75% 0.15 45/0.30))",
  },
  {
    id: "sunset",
    label: "Sunset",
    css: "linear-gradient(135deg, oklch(75% 0.18 35/0.30), oklch(70% 0.20 15/0.30), oklch(60% 0.22 350/0.30))",
  },
  {
    id: "ocean",
    label: "Ocean",
    css: "linear-gradient(180deg, oklch(70% 0.14 220/0.30), oklch(55% 0.15 240/0.30))",
  },
  {
    id: "forest",
    label: "Forest",
    css: "linear-gradient(135deg, oklch(70% 0.14 160/0.28), oklch(55% 0.14 180/0.28))",
  },
  {
    id: "dots",
    label: "Dots",
    css: "radial-gradient(oklch(65% 0.04 220 / 0.35) 1.2px, transparent 1.6px)",
    size: "18px 18px",
    repeat: "repeat",
  },
];

const CSS_COLOR_VAR = "--chat-bg-color";
const CSS_IMAGE_VAR = "--chat-bg-image";
const CSS_SIZE_VAR = "--chat-bg-size";
const CSS_REPEAT_VAR = "--chat-bg-repeat";

/**
 * Restrict user-provided image URLs to safe schemes. `javascript:` / `data:`
 * are rejected outright so a pasted string can't smuggle a script through the
 * CSS `url()` context — even though CSS-parsed `url()` doesn't execute JS,
 * we still keep the allowlist tight so this can be reused elsewhere.
 */
export function isSafeChatBgUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (value.length > 2048) return false;
  try {
    const u = new URL(value, "https://placeholder.local/");
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Escape double quotes so a URL can be safely wrapped in `url("…")`. */
function encodeUrlForCss(url: string): string {
  return url.replace(/"/g, "%22");
}

export function applyChatBackground(bg: ChatBackground): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.removeProperty(CSS_COLOR_VAR);
  root.style.removeProperty(CSS_IMAGE_VAR);
  root.style.removeProperty(CSS_SIZE_VAR);
  root.style.removeProperty(CSS_REPEAT_VAR);

  if (bg.kind === "color") {
    const preset = CHAT_BG_COLORS.find((p) => p.id === bg.id);
    if (preset && preset.css !== "transparent") {
      root.style.setProperty(CSS_COLOR_VAR, preset.css);
    }
    return;
  }
  if (bg.kind === "image") {
    const preset = CHAT_BG_IMAGES.find((p) => p.id === bg.id);
    if (!preset) return;
    root.style.setProperty(CSS_IMAGE_VAR, preset.css);
    if (preset.size) root.style.setProperty(CSS_SIZE_VAR, preset.size);
    if (preset.repeat) root.style.setProperty(CSS_REPEAT_VAR, preset.repeat);
    return;
  }
  if (bg.kind === "url" && isSafeChatBgUrl(bg.url)) {
    root.style.setProperty(CSS_IMAGE_VAR, `url("${encodeUrlForCss(bg.url.trim())}")`);
  }
}

export function loadChatBackground(): ChatBackground {
  if (typeof window === "undefined") return DEFAULT_CHAT_BG;
  try {
    const raw = window.localStorage.getItem(CHAT_BG_STORAGE_KEY);
    if (!raw) return DEFAULT_CHAT_BG;
    const parsed = JSON.parse(raw) as ChatBackground;
    if (
      (parsed.kind === "color" && CHAT_BG_COLORS.some((p) => p.id === parsed.id)) ||
      (parsed.kind === "image" && CHAT_BG_IMAGES.some((p) => p.id === parsed.id)) ||
      (parsed.kind === "url" && typeof parsed.url === "string" && isSafeChatBgUrl(parsed.url))
    ) {
      return parsed;
    }
  } catch {
    // Corrupted entry — fall through to default.
  }
  return DEFAULT_CHAT_BG;
}

export function saveChatBackground(bg: ChatBackground): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_BG_STORAGE_KEY, JSON.stringify(bg));
  } catch {
    // localStorage full / disabled — silently no-op; the in-memory state
    // still drives the current session.
  }
}

/**
 * Load a chat's per-conversation background override. Returns `null` if the
 * chat has no override (caller should fall back to the global default).
 */
export function loadChatBackgroundFor(chatId: number): ChatBackground | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(perChatKey(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatBackground;
    if (
      (parsed.kind === "color" && CHAT_BG_COLORS.some((p) => p.id === parsed.id)) ||
      (parsed.kind === "image" && CHAT_BG_IMAGES.some((p) => p.id === parsed.id)) ||
      (parsed.kind === "url" && typeof parsed.url === "string" && isSafeChatBgUrl(parsed.url))
    ) {
      return parsed;
    }
  } catch {
    // Corrupted entry — treat as "no override".
  }
  return null;
}

/**
 * Persist a chat's per-conversation background override. Pass `null` to
 * clear the override so the chat reverts to the global default.
 */
export function saveChatBackgroundFor(
  chatId: number,
  bg: ChatBackground | null,
): void {
  if (typeof window === "undefined") return;
  try {
    if (bg === null) {
      window.localStorage.removeItem(perChatKey(chatId));
    } else {
      window.localStorage.setItem(perChatKey(chatId), JSON.stringify(bg));
    }
  } catch {
    // ignore
  }
}

/**
 * Compute the background that should be applied for a given (or no) active
 * chat. Per-chat override wins; otherwise fall back to the persisted global
 * default; otherwise the built-in default.
 */
export function resolveChatBackground(chatId: number | null): ChatBackground {
  if (chatId !== null) {
    const override = loadChatBackgroundFor(chatId);
    if (override) return override;
  }
  return loadChatBackground();
}
