import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Passphrase hashing for the Generate button. Format: scrypt$N$r$p$saltBase64$hashBase64.
 * Imported through the "@dispatch/core/passphrase" subpath so the site's server routes do not
 * pull in the rest of the core package.
 */

const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const PREFIX = "scrypt";
// scrypt needs about 128 * N * r bytes; give it headroom above the 32 MiB default limit.
const MAX_MEM = 128 * 1024 * 1024;

function derive(
  passphrase: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N, r, p, maxmem: MAX_MEM },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

export async function hashPassphrase(passphrase: string): Promise<string> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(passphrase, salt, PARAMS.N, PARAMS.r, PARAMS.p);
  return [
    PREFIX,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/** Constant-time check. Returns false for any malformed stored value instead of throwing. */
export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || !saltB64 || !hashB64) return false;
  // Refuse parameters that would let a tampered secret exhaust memory.
  if (N > 2 ** 17 || r > 16 || p > 4) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(passphrase, Buffer.from(saltB64, "base64"), N, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
