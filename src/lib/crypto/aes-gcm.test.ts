import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./aes-gcm";

// 32 bytes of random-looking data → base64-encoded 44 chars. Tests use a
// stable secret so results are reproducible across runs.
const SECRET = "GfvY+CzC5T30tPTV4nR1NRvNPQEwbtCaOdI/OZQPQnw=";
const OTHER_SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("aes-gcm", () => {
    it("roundtrips ASCII plaintext", async () => {
        const original = "hello world";
        const encrypted = await encrypt(original, SECRET);
        const decrypted = await decrypt(encrypted, SECRET);
        expect(decrypted).toBe(original);
    });

    it("roundtrips unicode + emoji", async () => {
        const original = "សួស្តី 🌍 сообщение";
        const encrypted = await encrypt(original, SECRET);
        const decrypted = await decrypt(encrypted, SECRET);
        expect(decrypted).toBe(original);
    });

    it("roundtrips a bot token", async () => {
        const original = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawa";
        const encrypted = await encrypt(original, SECRET);
        const decrypted = await decrypt(encrypted, SECRET);
        expect(decrypted).toBe(original);
    });

    it("produces different ciphertext for the same plaintext (fresh IV per call)", async () => {
        const a = await encrypt("same input", SECRET);
        const b = await encrypt("same input", SECRET);
        expect(a).not.toBe(b);
        // But both must still decrypt to the same value.
        expect(await decrypt(a, SECRET)).toBe("same input");
        expect(await decrypt(b, SECRET)).toBe("same input");
    });

    it("fails to decrypt when secret is wrong", async () => {
        const encrypted = await encrypt("secret payload", SECRET);
        await expect(decrypt(encrypted, OTHER_SECRET)).rejects.toBeInstanceOf(Error);
    });

    it("fails to decrypt when ciphertext is tampered", async () => {
        const encrypted = await encrypt("secret payload", SECRET);
        // Flip a byte near the end (in the ciphertext, not the IV).
        const bytes = Buffer.from(encrypted, "base64");
        bytes[bytes.length - 1] ^= 0x01;
        const tampered = bytes.toString("base64");
        await expect(decrypt(tampered, SECRET)).rejects.toBeInstanceOf(Error);
    });

    it("throws on a secret that isn't 32 bytes", async () => {
        const badSecret = Buffer.from("too short").toString("base64");
        await expect(encrypt("x", badSecret)).rejects.toThrow(/32 bytes/);
    });

    it("throws on ciphertext shorter than the IV", async () => {
        const tooShort = Buffer.from([1, 2, 3]).toString("base64");
        await expect(decrypt(tooShort, SECRET)).rejects.toThrow(/too short/);
    });
});
