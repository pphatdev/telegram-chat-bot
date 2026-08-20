import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Signed session cookie helpers.
 *
 * Payload (`{userId, botId, exp}`) is base64url-encoded JSON, appended with a
 * `.` separator and an HMAC-SHA256 signature keyed by env.ENCRYPTION_SECRET.
 * We only sign, we don't encrypt — userId isn't secret, tamper resistance is.
 *
 * On verify we do a timing-safe MAC compare, then check `exp`. If either
 * fails we return null so callers treat the request as unauthenticated.
 */

export const SESSION_COOKIE = "telegram_bot_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  userId: number;
  botId: number;
  /** Unix seconds. */
  exp: number;
}

export async function issueSession(payload: Omit<SessionPayload, "exp">): Promise<void> {
  const full: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await signToken(full);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return verifyToken(raw);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Middleware-friendly variant: verifies a token given the raw string plus the
 * secret binding. Needed because next/headers cookies() isn't available in
 * Edge middleware.
 */
export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  return verifyTokenWithSecret(token, secret);
}

async function signToken(payload: SessionPayload): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const body = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await mac(body, env.ENCRYPTION_SECRET);
  return `${body}.${sig}`;
}

async function verifyToken(token: string): Promise<SessionPayload | null> {
  const { env } = await getCloudflareContext({ async: true });
  return verifyTokenWithSecret(token, env.ENCRYPTION_SECRET);
}

async function verifyTokenWithSecret(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expectedSig = await mac(body, secret);
  if (!timingSafeEqualStr(sig, expectedSig)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body))) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  if (typeof payload.userId !== "number" || typeof payload.botId !== "number") return null;
  return payload;
}

async function mac(body: string, secretBase64: string): Promise<string> {
  const raw = base64ToBytes(secretBase64);
  const key = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body) as BufferSource,
  );
  return base64urlEncode(new Uint8Array(sig));
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  const len = Math.max(bufA.byteLength, bufB.byteLength);
  let mismatch = bufA.byteLength ^ bufB.byteLength;
  for (let i = 0; i < len; i++) mismatch |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  return mismatch === 0;
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
