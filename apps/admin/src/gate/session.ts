/**
 * The command center's session cookie: a signed end time, made by the gate (gate.ts) at sign-in and
 * read by whoever must know the owner is signed in, which is the gate and the reader's two report
 * routes (apps/web/src/server/adminGuard.ts). Web Crypto only, so it runs in Vercel Routing
 * Middleware, a function and the reader's server alike.
 */

export const COOKIE = "singularity_admin";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

export async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Equal strings, compared without stopping at the first difference. */
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A session value: when it ends, and the signature of that moment. */
export async function createSession(secret: string, now: number): Promise<string> {
  const ends = Math.floor(now / 1000) + SESSION_SECONDS;
  return `${ends}.${await hmac(secret, `session:${ends}`)}`;
}

export async function sessionValid(
  value: string | undefined,
  secret: string,
  now: number,
): Promise<boolean> {
  if (!value) return false;
  const [ends, signature] = value.split(".");
  if (!ends || !signature || !/^\d+$/.test(ends)) return false;
  if (Number(ends) * 1000 <= now) return false;
  return same(signature, await hmac(secret, `session:${ends}`));
}

export function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
