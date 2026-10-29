/**
 * The command center's gate (D218). Vercel's Deployment Protection cannot guard a project that is
 * reached through another project's rewrite, so the app guards itself: one owner password from an
 * environment variable, a signed session cookie, and every address behind them except the login
 * page and its assets. It runs as Vercel Routing Middleware (../../middleware.ts), in front of the
 * static files. With no password or no secret set, nothing opens: the gate fails closed.
 *
 * The app answers under /admin on the reader's domain by a rewrite that strips the prefix, and
 * under its own address without it, so a path is read with or without /admin.
 */

export interface GateEnv {
  /** The owner password (ADMIN_PASSWORD). */
  password?: string;
  /** Signs the session cookie (ADMIN_SESSION_SECRET), at least 32 characters. */
  secret?: string;
}

const BASE = "/admin";
const COOKIE = "singularity_admin";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
/** A wrong password waits this long before it is answered, so guessing is slow. */
const WRONG_PASSWORD_MS = 600;
const MIN_SECRET = 32;
const PUBLIC_PATHS = new Set(["/login", "/login/", "/favicon.svg", "/robots.txt"]);

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
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
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The password check: both sides are hashed first, so the compare never sees a length or a prefix. */
async function passwordMatches(given: string, expected: string, secret: string): Promise<boolean> {
  return same(await hmac(secret, `password:${given}`), await hmac(secret, `password:${expected}`));
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

function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

const cookieHeader = (value: string, maxAge: number): string =>
  `${COOKIE}=${value}; Path=${BASE}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

const redirect = (to: string, cookie?: string): Response => {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
};

/**
 * The gate's answer for a request: a Response to send instead of the page, or `undefined` to let the
 * request through to the static files.
 */
export async function guard(
  request: Request,
  env: GateEnv,
  now: number = Date.now(),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response | undefined> {
  const { password, secret } = env;
  if (!password || !secret || secret.length < MIN_SECRET) {
    return new Response(
      "The command center is not set up: ADMIN_PASSWORD and ADMIN_SESSION_SECRET are missing.",
      {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      },
    );
  }
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin(?=\/|$)/, "") || "/";

  if (request.method === "POST" && path === "/login") {
    const form = await request.formData().catch(() => null);
    const given = form?.get("password");
    if (typeof given === "string" && (await passwordMatches(given, password, secret))) {
      return redirect(BASE, cookieHeader(await createSession(secret, now), SESSION_SECONDS));
    }
    await wait(WRONG_PASSWORD_MS);
    return redirect(`${BASE}/login?e=1`);
  }
  if (request.method === "POST" && path === "/logout") {
    return redirect(`${BASE}/login`, cookieHeader("", 0));
  }

  const open =
    (request.method === "GET" || request.method === "HEAD") &&
    (PUBLIC_PATHS.has(path) || path.startsWith("/_astro/"));
  if (open) return undefined;
  if (await sessionValid(cookieOf(request, COOKIE), secret, now)) return undefined;
  return redirect(`${BASE}/login`);
}
