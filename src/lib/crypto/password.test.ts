import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
    it("produces the expected pbkdf2$iter$salt$hash format", async () => {
        const hash = await hashPassword("hunter2");
        const parts = hash.split("$");
        expect(parts).toHaveLength(4);
        expect(parts[0]).toBe("pbkdf2");
        expect(Number.parseInt(parts[1], 10)).toBeGreaterThanOrEqual(100_000);
        expect(parts[2]).toMatch(/^[A-Za-z0-9+/=]+$/); // base64 salt
        expect(parts[3]).toMatch(/^[A-Za-z0-9+/=]+$/); // base64 hash
    });

    it("uses a unique salt for each hash", async () => {
        const a = await hashPassword("hunter2");
        const b = await hashPassword("hunter2");
        expect(a).not.toBe(b);
    });

    it("verifies the correct password", async () => {
        const hash = await hashPassword("correct horse battery staple");
        expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    });

    it("rejects the wrong password", async () => {
        const hash = await hashPassword("correct horse battery staple");
        expect(await verifyPassword("wrong horse battery staple", hash)).toBe(false);
    });

    it("rejects an empty string when the password wasn't empty", async () => {
        const hash = await hashPassword("something");
        expect(await verifyPassword("", hash)).toBe(false);
    });

    it("returns false for a malformed stored hash", async () => {
        expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
        expect(await verifyPassword("anything", "pbkdf2$abc$def$ghi")).toBe(false);
        expect(await verifyPassword("anything", "bcrypt$10$foo$bar")).toBe(false);
    });

    it("returns false when iteration count is nonsensically low", async () => {
        // Handcrafted format with iterations=1 — should be rejected as
        // suspicious even if the format is otherwise valid.
        const bogus = "pbkdf2$1$AAAA$BBBB";
        expect(await verifyPassword("anything", bogus)).toBe(false);
    });
});
