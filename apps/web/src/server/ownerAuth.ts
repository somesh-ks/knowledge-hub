import { createHash, timingSafeEqual } from "node:crypto";
import { isSameOrigin } from "./generate";
import { type ApiResult, toResponse } from "./http";

/**
 * Who may change anything (D197). The Origin check alone stops a page on another site, but any
 * client outside a browser sets Origin freely, or sends none (which `isSameOrigin` allows). So a
 * write route also needs the owner's secret: `SINGULARITY_OWNER_TOKEN`, held by the owner's devices
 * in an HttpOnly cookie (set through /settings/device) and by scripts as a bearer token.
 *
 * Unset or shorter than 16 characters, the secret is not enforced and each instance logs one
 * warning, so deploying this before the owner sets it locks nobody out.
 */
export const OWNER_COOKIE = "sg_owner";
export const MIN_OWNER_TOKEN_CHARS = 16;
/** Chrome caps a cookie's life at 400 days. */
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

export interface OwnerEnv {
  SINGULARITY_OWNER_TOKEN?: string;
}

/** The configured secret, or null when it is unset or too short to count. */
function secretOf(env: OwnerEnv): string | null {
  const secret = env.SINGULARITY_OWNER_TOKEN;
  return secret !== undefined && secret.length >= MIN_OWNER_TOKEN_CHARS ? secret : null;
}

/** Compares digests, so the time taken says nothing about the secret, even its length. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function cookieValue(header: string | null): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === OWNER_COOKIE) {
      const raw = rest.join("=");
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function bearerValue(header: string | null): string | null {
  const match = /^Bearer (.+)$/i.exec(header ?? "");
  return match ? (match[1] ?? null) : null;
}

let warned = false;

/**
 * Null to go ahead (the request carries the owner's secret, or none is configured), else the 401 to
 * answer with. Call it first in a write route; a handler's own origin and body checks follow.
 */
export function requireOwner(
  request: Request,
  env: OwnerEnv = process.env,
  warn: (message: string) => void = (message) => console.error(message),
): Response | null {
  const secret = secretOf(env);
  if (secret === null) {
    if (!warned) {
      warned = true;
      warn(
        "[owner-auth] SINGULARITY_OWNER_TOKEN is unset or under 16 characters: writes are open to any client that passes the Origin check",
      );
    }
    return null;
  }
  const given = [
    cookieValue(request.headers.get("cookie")),
    bearerValue(request.headers.get("authorization")),
  ];
  // Both are compared, so which one matched is not observable in the time taken.
  const matches = given.map((value) => value !== null && sameSecret(value, secret));
  if (matches.some(Boolean)) return null;
  return toResponse({ status: 401, body: { error: "owner_required" } });
}

/** True when the request already carries the owner's secret and the site enforces one. */
export function isTrusted(request: Request, env: OwnerEnv = process.env): boolean {
  return secretOf(env) !== null && requireOwner(request, env) === null;
}

/** Whether the site enforces an owner secret at all. */
export const isEnforced = (env: OwnerEnv = process.env): boolean => secretOf(env) !== null;

export interface TrustInput {
  bodyText: string;
  origin: string | null;
  expectedOrigin: string;
}

/** "Trust this device": the right token in, the owner cookie out. */
export function trustDevice(input: TrustInput, env: OwnerEnv = process.env): ApiResult<unknown> {
  if (!isSameOrigin(input.origin, input.expectedOrigin)) {
    return { status: 403, body: { error: "forbidden_origin" } };
  }
  const secret = secretOf(env);
  if (secret === null) return { status: 409, body: { error: "not_configured" } };
  let token: unknown;
  try {
    token = (JSON.parse(input.bodyText) as { token?: unknown }).token;
  } catch {
    return { status: 400, body: { error: "invalid_request" } };
  }
  if (typeof token !== "string" || token.length > 512 || !sameSecret(token.trim(), secret)) {
    return { status: 401, body: { error: "owner_required" } };
  }
  return {
    status: 204,
    body: null,
    headers: {
      "Set-Cookie": `${OWNER_COOKIE}=${encodeURIComponent(secret)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; Secure; SameSite=Strict`,
    },
  };
}

/** The cookie that ends the trust. */
export const FORGET_COOKIE = `${OWNER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
