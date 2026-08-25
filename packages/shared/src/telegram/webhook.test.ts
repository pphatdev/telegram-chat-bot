import { describe, expect, it } from "vitest";
import {
    deriveWebhookSecret,
    timingSafeEqual,
    verifyWebhookSecret,
    WEBHOOK_SECRET_HEADER,
} from "./webhook";

describe("timingSafeEqual", () => {
    it("returns true for equal strings", () => {
        expect(timingSafeEqual("abc", "abc")).toBe(true);
        expect(timingSafeEqual("", "")).toBe(true);
        expect(timingSafeEqual("a".repeat(1000), "a".repeat(1000))).toBe(true);
    });

    it("returns false for unequal strings", () => {
        expect(timingSafeEqual("abc", "abd")).toBe(false);
        expect(timingSafeEqual("abc", "abcd")).toBe(false);
        expect(timingSafeEqual("abcd", "abc")).toBe(false);
        expect(timingSafeEqual("abc", "")).toBe(false);
    });

    it("handles unicode without misalignment", () => {
        expect(timingSafeEqual("ñ", "ñ")).toBe(true);
        expect(timingSafeEqual("ñ", "n")).toBe(false);
    });
});

describe("verifyWebhookSecret", () => {
    const SECRET = "abcdef0123456789";

    it("accepts a matching header", () => {
        const h = new Headers({ [WEBHOOK_SECRET_HEADER]: SECRET });
        expect(verifyWebhookSecret(h, SECRET)).toBe(true);
    });

    it("rejects a missing header", () => {
        const h = new Headers();
        expect(verifyWebhookSecret(h, SECRET)).toBe(false);
    });

    it("rejects a mismatched header", () => {
        const h = new Headers({ [WEBHOOK_SECRET_HEADER]: "wrong" });
        expect(verifyWebhookSecret(h, SECRET)).toBe(false);
    });

    it("rejects when the expected secret is empty", () => {
        const h = new Headers({ [WEBHOOK_SECRET_HEADER]: "anything" });
        expect(verifyWebhookSecret(h, "")).toBe(false);
        expect(verifyWebhookSecret(h, undefined)).toBe(false);
    });

    it("is case-insensitive on the header name (per HTTP spec)", () => {
        const h = new Headers({ "X-Telegram-Bot-Api-Secret-Token": SECRET });
        expect(verifyWebhookSecret(h, SECRET)).toBe(true);
    });
});

describe("deriveWebhookSecret", () => {
    const HASH = "pbkdf2$100000$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaGhhc2hoYXNoaGFzaA==";

    it("is deterministic for the same inputs", async () => {
        const a = await deriveWebhookSecret(HASH, 42);
        const b = await deriveWebhookSecret(HASH, 42);
        expect(a).toBe(b);
    });

    it("changes when the botId changes", async () => {
        const a = await deriveWebhookSecret(HASH, 1);
        const b = await deriveWebhookSecret(HASH, 2);
        expect(a).not.toBe(b);
    });

    it("changes when the passwordHash changes", async () => {
        const a = await deriveWebhookSecret(HASH, 1);
        const b = await deriveWebhookSecret(HASH + "x", 1);
        expect(a).not.toBe(b);
    });

    it("produces only Telegram-safe characters (A-Z a-z 0-9 _ -)", async () => {
        const secret = await deriveWebhookSecret(HASH, 12345);
        expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
        // 32-byte HMAC-SHA256 → 43 chars base64url (no padding).
        expect(secret.length).toBe(43);
    });

    it("rejects empty passwordHash", async () => {
        await expect(deriveWebhookSecret("", 1)).rejects.toThrow(/passwordHash/);
    });

    it("rejects non-positive botId", async () => {
        await expect(deriveWebhookSecret(HASH, 0)).rejects.toThrow(/botId/);
        await expect(deriveWebhookSecret(HASH, -1)).rejects.toThrow(/botId/);
        await expect(deriveWebhookSecret(HASH, Number.NaN)).rejects.toThrow(/botId/);
    });
});
