import { describe, expect, it } from "vitest";
import {
    loginApiKeySchema,
    loginCredentialsSchema,
    signupSchema,
} from "./auth";

describe("loginApiKeySchema", () => {
    it("accepts a valid Telegram token", () => {
        const r = loginApiKeySchema.safeParse({
            token: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawa",
        });
        expect(r.success).toBe(true);
    });

    it("rejects the wrong shape", () => {
        for (const bad of [
            "",
            "not-a-token",
            "123:short",
            "abcdefghij:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawa", // non-numeric prefix
            "1:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawa", // prefix too short
        ]) {
            const r = loginApiKeySchema.safeParse({ token: bad });
            expect(r.success, `should reject ${JSON.stringify(bad)}`).toBe(false);
        }
    });
});

describe("loginCredentialsSchema", () => {
    it("accepts a valid pair", () => {
        const r = loginCredentialsSchema.safeParse({
            username: "operator@example.com",
            password: "hunter2",
        });
        expect(r.success).toBe(true);
    });

    it("rejects an empty username", () => {
        const r = loginCredentialsSchema.safeParse({ username: "", password: "hunter2" });
        expect(r.success).toBe(false);
    });

    it("rejects a password under 6 chars", () => {
        const r = loginCredentialsSchema.safeParse({ username: "u", password: "12345" });
        expect(r.success).toBe(false);
    });
});

describe("signupSchema", () => {
    const good = {
        name: "Real Person",
        username: "real.person_1",
        email: "person@example.com",
        apiKey: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawa",
        password: "hunter22",
        confirmPassword: "hunter22",
    };

    it("accepts a fully valid signup", () => {
        const r = signupSchema.safeParse(good);
        expect(r.success).toBe(true);
    });

    it("rejects when passwords don't match — with path=[confirmPassword]", () => {
        const r = signupSchema.safeParse({ ...good, confirmPassword: "different2" });
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(r.error.issues.some((i) => i.path.includes("confirmPassword"))).toBe(true);
        }
    });

    it("rejects a username with invalid characters", () => {
        const r = signupSchema.safeParse({ ...good, username: "real person!" });
        expect(r.success).toBe(false);
    });

    it("rejects usernames under 3 chars", () => {
        const r = signupSchema.safeParse({ ...good, username: "ab" });
        expect(r.success).toBe(false);
    });

    it("rejects malformed emails", () => {
        const r = signupSchema.safeParse({ ...good, email: "not-an-email" });
        expect(r.success).toBe(false);
    });
});
