/**
 * The command center's gate (D224). Vercel's Deployment Protection cannot guard a project that is
 * reached through another project's rewrite, so the app guards itself: one owner password from an
 * environment variable, a signed session cookie, and every address behind them except the login
 * page and its assets. It runs as Vercel Routing Middleware (../../middleware.ts), in front of the
 * static files. With no way to sign in (a password or Google, google.ts) or no secret set, nothing
 * opens: the gate fails closed. Google is the way in; the password stays as a break-glass.
 *
 * The app answers under /admin on the reader's domain by a rewrite that strips the prefix, and
 * under its own address without it, so a path is read with or without /admin.
 */

import {
  begin,
  type Exchange,
  exchangeWithGoogle,
  finish,
  type GoogleEnv,
  OAUTH_COOKIE,
  OAUTH_SECONDS,
} from "./google.js";
import {
  COOKIE,
  cookieOf,
  createSession,
  hmac,
  SESSION_SECONDS,
  same,
  sessionValid,
} from "./session.js";

export interface GateEnv {
  /** The owner password (ADMIN_PASSWORD), the break-glass beside Google. */
  password?: string;
  /** Google sign-in (GOOGLE_CLIENT_ID and friends, see googleEnvFrom); absent while it is not set up. */
  google?: GoogleEnv;
  /** Signs the session cookie (ADMIN_SESSION_SECRET), at least 32 characters. */
  secret?: string;
}

const BASE = "/admin";
/** A wrong password waits this long before it is answered, so guessing is slow. */
const WRONG_PASSWORD_MS = 600;
const MIN_SECRET = 32;
const PUBLIC_PATHS = new Set(["/login", "/login/", "/favicon.svg", "/robots.txt"]);
const GOOGLE_START = "/login/google";
const GOOGLE_CALLBACK = "/login/google/callback";
/** The sign-in page's `e` codes: 1 wrong password, 2 Google not set up, 3 Google did not let you in. */
const NOT_SET_UP = `${BASE}/login?e=2`;
const REFUSED = `${BASE}/login?e=3`;

/** The password check: both sides are hashed first, so the compare never sees a length or a prefix. */
async function passwordMatches(given: string, expected: string, secret: string): Promise<boolean> {
  return same(await hmac(secret, `password:${given}`), await hmac(secret, `password:${expected}`));
}

/**
 * The session cookie covers the whole domain, not just /admin: the reader's /api/costs and
 * /api/health answer only to it. `path` is "/" for a sign-in and also "/admin" when clearing, for
 * cookies set before the cookie went site-wide.
 */
const cookieHeader = (value: string, maxAge: number, path = "/", name = COOKIE): string =>
  `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

/** The cookie that carries a Google sign-in's state across the round trip; only its two addresses see it. */
const OAUTH_PATH = `${BASE}${GOOGLE_START}`;

const redirect = (to: string, ...cookies: string[]): Response => {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
};

/** The way in, however it was proven: the one signed session, set for the whole domain. */
async function signedIn(secret: string, now: number, ...also: string[]): Promise<Response> {
  return redirect(
    BASE,
    cookieHeader(await createSession(secret, now), SESSION_SECONDS),
    // A cookie from before the cookie went site-wide would be sent first and could shadow this one.
    cookieHeader("", 0, BASE),
    ...also,
  );
}

/**
 * The gate's answer for a request: a Response to send instead of the page, or `undefined` to let the
 * request through to the static files.
 */
export async function guard(
  request: Request,
  env: GateEnv,
  now: number = Date.now(),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  exchange: Exchange = exchangeWithGoogle,
): Promise<Response | undefined> {
  const { password, google, secret } = env;
  if ((!password && !google) || !secret || secret.length < MIN_SECRET) {
    return new Response(
      "The command center is not set up: a sign-in (ADMIN_PASSWORD or the Google variables) and ADMIN_SESSION_SECRET are missing.",
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
    if (password && typeof given === "string" && (await passwordMatches(given, password, secret))) {
      return signedIn(secret, now);
    }
    await wait(WRONG_PASSWORD_MS);
    return redirect(`${BASE}/login?e=1`);
  }
  if (request.method === "GET" && path === GOOGLE_START) {
    if (!google) return redirect(NOT_SET_UP);
    const { location, cookie } = await begin(google, secret, now);
    return redirect(location, cookieHeader(cookie, OAUTH_SECONDS, OAUTH_PATH, OAUTH_COOKIE));
  }
  if (request.method === "GET" && path === GOOGLE_CALLBACK) {
    if (!google) return redirect(NOT_SET_UP);
    const cleared = cookieHeader("", 0, OAUTH_PATH, OAUTH_COOKIE);
    const owner = await finish(url, cookieOf(request, OAUTH_COOKIE), google, secret, now, exchange);
    return owner ? signedIn(secret, now, cleared) : redirect(REFUSED, cleared);
  }
  if (request.method === "POST" && path === "/logout") {
    return redirect(`${BASE}/login`, cookieHeader("", 0), cookieHeader("", 0, BASE));
  }

  const open =
    (request.method === "GET" || request.method === "HEAD") &&
    (PUBLIC_PATHS.has(path) || path.startsWith("/_astro/"));
  if (open) return undefined;
  if (await sessionValid(cookieOf(request, COOKIE), secret, now)) return undefined;
  return redirect(`${BASE}/login`);
}
