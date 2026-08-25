/**
 * PBKDF2 password hashing for operator accounts.
 *
 * Stored format: `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`
 *
 * The iteration count is embedded so we can bump it later without a schema
 * migration — `verify()` reads the count from the stored string. New hashes
 * always use `CURRENT_ITERATIONS`.
 *
 * PBKDF2 chosen over bcrypt/argon2 because it ships in Web Crypto and runs
 * on Cloudflare Workers without native bindings.
 */

const ALG = "PBKDF2";
const DIGEST: HashAlgorithmIdentifier = "SHA-256";
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 32;
const CURRENT_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await deriveBits(password, salt, CURRENT_ITERATIONS);
  return `pbkdf2$${CURRENT_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(derived))}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  const salt = base64ToBytes(parts[2]);
  const expected = base64ToBytes(parts[3]);
  const derived = new Uint8Array(await deriveBits(password, salt, iterations));
  return timingSafeEqualBytes(derived, expected);
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as BufferSource,
    { name: ALG },
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: ALG, hash: DIGEST, salt: salt as BufferSource, iterations },
    material,
    KEY_LENGTH_BITS,
  );
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.byteLength, b.byteLength);
  let mismatch = a.byteLength ^ b.byteLength;
  for (let i = 0; i < len; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
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
