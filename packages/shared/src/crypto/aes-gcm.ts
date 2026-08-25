/**
 * AES-GCM-256 encrypt-at-rest utility.
 *
 * Wraps values stored in D1 (bot tokens, session data, any sensitive
 * user-provided secret) using a 256-bit key derived from
 * `env.ENCRYPTION_SECRET`. Runs entirely on Web Crypto — no Node polyfills,
 * safe for the Cloudflare Workers runtime.
 *
 * On-disk format (base64-encoded):
 *   [ IV (12 bytes) || ciphertext || auth tag (16 bytes appended by AES-GCM) ]
 *
 * A fresh IV is generated per encryption via crypto.getRandomValues, so the
 * same plaintext + key never produces the same ciphertext.
 */

const ALG = "AES-GCM";
const KEY_LENGTH_BYTES = 32; // 256-bit
const IV_LENGTH_BYTES = 12; // 96-bit (GCM standard)

let cachedKeyPromise: Promise<CryptoKey> | null = null;
let cachedKeyMaterial: string | null = null;

async function importKey(secretBase64: string): Promise<CryptoKey> {
  if (typeof secretBase64 !== "string" || secretBase64.length === 0) {
    throw new Error(
      "ENCRYPTION_SECRET is not set. Copy .dev.vars.example to .dev.vars and set ENCRYPTION_SECRET (openssl rand -base64 32).",
    );
  }
  if (cachedKeyPromise && cachedKeyMaterial === secretBase64) {
    return cachedKeyPromise;
  }
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(secretBase64);
  } catch {
    throw new Error(
      "ENCRYPTION_SECRET is not valid base64. Generate a fresh one with: openssl rand -base64 32",
    );
  }
  if (raw.byteLength !== KEY_LENGTH_BYTES) {
    throw new Error(
      `ENCRYPTION_SECRET must decode to ${KEY_LENGTH_BYTES} bytes; got ${raw.byteLength}`,
    );
  }
  cachedKeyMaterial = secretBase64;
  cachedKeyPromise = crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: ALG, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKeyPromise;
}

export async function encrypt(
  plaintext: string,
  secretBase64: string,
): Promise<string> {
  const key = await importKey(secretBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: ALG, iv: iv as BufferSource },
    key,
    encoded as BufferSource,
  );
  return bytesToBase64(concat(iv, new Uint8Array(cipherBuffer)));
}

export async function decrypt(
  cipherBase64: string,
  secretBase64: string,
): Promise<string> {
  const key = await importKey(secretBase64);
  const bytes = base64ToBytes(cipherBase64);
  if (bytes.byteLength <= IV_LENGTH_BYTES) {
    throw new Error("Ciphertext is too short to contain an IV");
  }
  const iv = bytes.subarray(0, IV_LENGTH_BYTES);
  const cipher = bytes.subarray(IV_LENGTH_BYTES);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: ALG, iv: iv as BufferSource },
    key,
    cipher as BufferSource,
  );
  return new TextDecoder().decode(plainBuffer);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
