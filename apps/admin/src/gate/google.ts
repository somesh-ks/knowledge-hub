/**
 * Google sign-in for the command center (authorization code flow with PKCE, a state and a nonce). It
 * only decides who the owner is: what it issues is the same signed session the password issues
 * (session.ts), so the gate and the reader's report routes read one cookie whichever way it was made.
 *
 * The id token comes straight from Google's token endpoint over TLS in answer to a code only this
 * browser holds the verifier for, so its claims are checked (issuer, audience, expiry, nonce,
 * verified email, allowlist) but its signature is not (OpenID Connect Core, 3.1.3.7).
 */

import { hmac, same } from "./session.js";

export const OAUTH_COOKIE = "singularity_admin_oauth";
/** The round trip to Google and back: long enough to pick an account, short enough to not linger. */
export const OAUTH_SECONDS = 10 * 60;

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const TOKEN_TIMEOUT_MS = 8000;

export interface GoogleEnv {
  clientId: string;
  clientSecret: string;
  /** The exact address registered with Google, e.g. https://news.someshks.work/admin/login/google/callback. */
  redirectUri: string;
  /** The Google accounts that may sign in, lowercase. */
  emails: string[];
}

/** The claims of an id token the gate reads. */
export interface IdClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
}

/** Trades a code for the id token's claims; a test stands in for Google here. */
export type Exchange = (env: GoogleEnv, code: string, verifier: string) => Promise<IdClaims>;

/** The four environment variables, or `undefined` while any is missing: Google sign-in stays off. */
export function googleEnvFrom(raw: {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  emails?: string;
}): GoogleEnv | undefined {
  const emails = (raw.emails ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!raw.clientId || !raw.clientSecret || !raw.redirectUri || emails.length === 0) {
    return undefined;
  }
  return {
    clientId: raw.clientId,
    clientSecret: raw.clientSecret,
    redirectUri: raw.redirectUri,
    emails,
  };
}

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const randomToken = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

async function challengeOf(verifier: string): Promise<string> {
  return base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
}

/**
 * The start of a sign-in: where to send the browser, and the cookie that remembers what it must get
 * back. The cookie holds the state, the nonce and the PKCE verifier, signed so a forged one fails.
 */
export async function begin(
  env: GoogleEnv,
  secret: string,
  now: number,
  random: () => string = randomToken,
): Promise<{ location: string; cookie: string }> {
  const [state, nonce, verifier] = [random(), random(), random()];
  const ends = Math.floor(now / 1000) + OAUTH_SECONDS;
  const payload = `${state}.${nonce}.${verifier}.${ends}`;
  const query = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return {
    location: `${AUTHORIZE_URL}?${query}`,
    cookie: `${payload}.${await hmac(secret, `oauth:${payload}`)}`,
  };
}

/** Whether Google's answer to a sign-in begun here is the owner. Anything off is a no, never a throw. */
export async function finish(
  url: URL,
  cookie: string | undefined,
  env: GoogleEnv,
  secret: string,
  now: number,
  exchange: Exchange,
): Promise<boolean> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const parts = cookie?.split(".") ?? [];
  if (!code || !state || parts.length !== 5) return false;
  const [savedState = "", nonce = "", verifier = "", ends = "", signature = ""] = parts;
  const payload = [savedState, nonce, verifier, ends].join(".");
  if (!same(signature, await hmac(secret, `oauth:${payload}`))) return false;
  if (!/^\d+$/.test(ends) || Number(ends) * 1000 <= now) return false;
  if (!same(state, savedState)) return false;

  let claims: IdClaims;
  try {
    claims = await exchange(env, code, verifier);
  } catch (error) {
    console.error("[admin] google sign-in: token exchange failed", (error as Error).message);
    return false;
  }
  const verified = claims.email_verified === true || claims.email_verified === "true";
  return (
    ISSUERS.has(claims.iss ?? "") &&
    claims.aud === env.clientId &&
    typeof claims.exp === "number" &&
    claims.exp * 1000 > now &&
    same(claims.nonce ?? "", nonce) &&
    verified &&
    env.emails.includes((claims.email ?? "").toLowerCase())
  );
}

/** The real exchange: Google's token endpoint, over TLS, with the client secret and the verifier. */
export const exchangeWithGoogle: Exchange = async (env, code, verifier) => {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`token endpoint answered ${response.status}`);
  const { id_token: token } = (await response.json()) as { id_token?: string };
  const body = token?.split(".")[1];
  if (!body) throw new Error("no id token");
  const padded = body.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))),
  ) as IdClaims;
};
