import { describe, expect, it } from "vitest";
import {
    outboundMessageSchema,
    sendDocumentSchema,
    sendPhotoSchema,
    sendTextSchema,
} from "./schemas";

describe("outboundMessageSchema (discriminated union)", () => {
    it("accepts a plain text send", () => {
        const r = outboundMessageSchema.safeParse({ kind: "text", text: "hello" });
        expect(r.success).toBe(true);
    });

    it("accepts a photo send with caption", () => {
        const r = outboundMessageSchema.safeParse({
            kind: "photo",
            mediaR2Key: "media/1/abc.jpg",
            caption: "look at this",
        });
        expect(r.success).toBe(true);
    });

    it("accepts a document send without caption", () => {
        const r = outboundMessageSchema.safeParse({
            kind: "document",
            mediaR2Key: "media/1/abc.pdf",
        });
        expect(r.success).toBe(true);
    });

    it("rejects an unknown kind", () => {
        const r = outboundMessageSchema.safeParse({ kind: "video", mediaR2Key: "x" });
        expect(r.success).toBe(false);
    });

    it("rejects text exceeding 4096 chars", () => {
        const r = sendTextSchema.safeParse({ kind: "text", text: "a".repeat(4097) });
        expect(r.success).toBe(false);
    });

    it("rejects empty text", () => {
        const r = sendTextSchema.safeParse({ kind: "text", text: "" });
        expect(r.success).toBe(false);
    });

    it("rejects a photo caption exceeding 1024 chars", () => {
        const r = sendPhotoSchema.safeParse({
            kind: "photo",
            mediaR2Key: "media/1/x.jpg",
            caption: "a".repeat(1025),
        });
        expect(r.success).toBe(false);
    });

    it("rejects an empty mediaR2Key on document", () => {
        const r = sendDocumentSchema.safeParse({ kind: "document", mediaR2Key: "" });
        expect(r.success).toBe(false);
    });
});

describe("inline keyboard XOR (url vs callback_data)", () => {
    it("accepts a URL-only button", () => {
        const r = sendTextSchema.safeParse({
            kind: "text",
            text: "click",
            replyMarkup: {
                inline_keyboard: [[{ text: "Open", url: "https://example.com" }]],
            },
        });
        expect(r.success).toBe(true);
    });

    it("accepts a callback-only button", () => {
        const r = sendTextSchema.safeParse({
            kind: "text",
            text: "click",
            replyMarkup: {
                inline_keyboard: [[{ text: "Yes", callback_data: "answer:yes" }]],
            },
        });
        expect(r.success).toBe(true);
    });

    it("rejects a button with both url AND callback_data", () => {
        const r = sendTextSchema.safeParse({
            kind: "text",
            text: "click",
            replyMarkup: {
                inline_keyboard: [[{ text: "Bad", url: "https://x", callback_data: "y" }]],
            },
        });
        expect(r.success).toBe(false);
    });

    it("rejects a button with neither url NOR callback_data", () => {
        const r = sendTextSchema.safeParse({
            kind: "text",
            text: "click",
            replyMarkup: {
                inline_keyboard: [[{ text: "Bare" }]],
            },
        });
        expect(r.success).toBe(false);
    });

    it("rejects an inline keyboard exceeding 8 rows", () => {
        const row = [{ text: "x", callback_data: "y" }];
        const r = sendTextSchema.safeParse({
            kind: "text",
            text: "click",
            replyMarkup: { inline_keyboard: Array(9).fill(row) },
        });
        expect(r.success).toBe(false);
    });

    it("rejects a button text exceeding 64 chars", () => {
        const r = sendTextSchema.safeParse({
            kind: "text",
            text: "click",
            replyMarkup: {
                inline_keyboard: [[{ text: "a".repeat(65), callback_data: "y" }]],
            },
        });
        expect(r.success).toBe(false);
    });
});
