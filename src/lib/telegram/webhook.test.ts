import { describe, expect, it } from "vitest";
import { timingSafeEqual, verifyWebhookSecret, WEBHOOK_SECRET_HEADER } from "./webhook";

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
