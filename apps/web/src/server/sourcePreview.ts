import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { deriveSourceFormat, type SourceFormat } from "@dispatch/core";
import {
  createPreviewHttp,
  PreviewError,
  previewSource,
  type SourcePreview,
} from "@dispatch/engine/source-preview";
import type { ApiResult } from "./http";

/**
 * GET /api/source-preview?url=: what an address would be as a source, for the Add source form.
 *
 * The function fetches an address a stranger chose, so every request it makes passes a guard: only
 * https on the default port, no credentials, and a host whose every resolved address is public
 * (not loopback, private, link-local, carrier-grade NAT, multicast or a cloud metadata address).
 * Redirects are followed by hand, up to five hops, and each hop is checked again, so a public page
 * cannot bounce the function to an internal one. Answers are cached ten minutes in memory and each
 * client may ask 20 times a minute; the shared limits module counts workflow runs and does not fit.
 *
 * Known limit: the address is resolved to check it and again when connecting, so a host that
 * answers differently the second time (DNS rebinding) is not caught by the check alone.
 */

export const MAX_URL_CHARS = 8192;
export const CACHE_TTL_MS = 10 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 200;
export const RATE_LIMIT = 20;
export const RATE_WINDOW_MS = 60 * 1000;
export const OVERALL_TIMEOUT_MS = 9000;
/** Jev gets this long to place the format; after it the type's rule stands and the answer goes out (D75). */
export const FORMAT_TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 5;

// -------------------------------------------------------------------------------------- the guard

export type GuardReason = "invalid" | "blocked";

export class GuardError extends Error {
  constructor(
    readonly reason: GuardReason,
    message: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

function ipv4Bytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function blockedV4(b: readonly number[]): boolean {
  const [a = 0, c = 0, d = 0] = b;
  return (
    a === 0 || // "this" network
    a === 10 ||
    (a === 100 && c >= 64 && c <= 127) || // carrier-grade NAT
    a === 127 ||
    (a === 169 && c === 254) || // link-local, including the metadata address 169.254.169.254
    (a === 172 && c >= 16 && c <= 31) ||
    (a === 192 && c === 0 && d === 0) || // IETF protocol assignments
    (a === 192 && c === 168) ||
    (a === 198 && (c === 18 || c === 19)) || // benchmarking
    a >= 224 // multicast, reserved and broadcast
  );
}

function ipv6Bytes(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const embedded = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (embedded) {
    const v4 = ipv4Bytes(embedded[2] ?? "");
    if (!v4) return null;
    text = `${embedded[1]}${(((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16)}:${(((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<string>(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function blockedV6(b: readonly number[]): boolean {
  const first = b[0] ?? 0;
  const second = b[1] ?? 0;
  const zeros = (from: number, to: number): boolean => b.slice(from, to).every((x) => x === 0);
  const tail = b.slice(12, 16);
  if (zeros(0, 15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return blockedV4(tail); // ::ffff:a.b.c.d
  if (zeros(0, 12)) return blockedV4(tail); // ::a.b.c.d
  if (first === 0 && second === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) {
    return blockedV4(tail); // 64:ff9b::/96, NAT64
  }
  if (first === 0x20 && second === 0x02) return blockedV4(b.slice(2, 6)); // 6to4
  if (first === 0x20 && second === 0x01 && b[2] === 0 && b[3] === 0) return true; // Teredo
  if ((first & 0xfe) === 0xfc) return true; // unique local fc00::/7
  if (first === 0xfe && (second & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (first === 0xff) return true; // multicast
  return false;
}

/** True for an address that must not be fetched. Anything that does not parse counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const bytes = ipv4Bytes(address);
    return bytes === null || blockedV4(bytes);
  }
  if (version === 6) {
    const bytes = ipv6Bytes(address);
    return bytes === null || blockedV6(bytes);
  }
  return true;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

/** The address as an https URL object, or why it was refused. Makes no network request. */
export function parseTargetUrl(raw: string): URL {
  if (raw.length === 0 || raw.length > MAX_URL_CHARS) {
    throw new GuardError("invalid", "The address is empty or too long.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new GuardError("invalid", "That is not a valid address.");
  }
  if (url.protocol !== "https:") throw new GuardError("invalid", "Only https addresses work.");
  if (url.username !== "" || url.password !== "") {
    throw new GuardError("invalid", "An address with a login in it is not allowed.");
  }
  if (url.port !== "") throw new GuardError("invalid", "Only the standard https port works.");
  if (url.hostname === "") throw new GuardError("invalid", "That address has no host.");
  return url;
}

export type Resolver = (host: string) => Promise<string[]>;

export const resolveAll: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Refuses a host that is, or resolves to, a non-public address. Every resolved address is checked,
 * because a name may list a public address next to an internal one.
 */
export async function assertPublicHost(url: URL, resolve: Resolver): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw new GuardError("blocked", "That address is not public.");
    return;
  }
  if (BLOCKED_NAMES.test(host)) throw new GuardError("blocked", "That host is not public.");
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new GuardError("blocked", "That host does not resolve.");
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new GuardError("blocked", "That host is not public.");
  }
}

// ---------------------------------------------------------------------------------- guarded fetch

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A fetch that checks the address and every redirect hop before connecting. Redirects are followed
 * here, not by fetch, so a hop to another host is checked like the first request. The final
 * response reports the address it came from, as the preview code expects.
 */
export function guardedFetch(fetchImpl: FetchImpl, resolve: Resolver): FetchImpl {
  return async (input, init) => {
    let current = input;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = parseTargetUrl(current);
      await assertPublicHost(url, resolve);
      const response = await fetchImpl(url.toString(), { ...init, redirect: "manual" });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, url).toString();
        continue;
      }
      Object.defineProperty(response, "url", { value: url.toString() });
      return response;
    }
    throw new GuardError("blocked", "Too many redirects.");
  };
}

// ------------------------------------------------------------------------------------- the handler

/** A preview with the format Jev gave it, or the type's rule when Jev was slow or unavailable. */
export type FormattedPreview = SourcePreview & { format: SourceFormat; format_by: "jev" | "rule" };

export type SourcePreviewBody =
  | FormattedPreview
  | { error: "invalid" | "unreachable" | "timeout" | "rate_limited"; message: string };

export interface SourcePreviewInput {
  rawUrl: string | null;
  /** Who is asking, such as the forwarded address; limits are counted per client. */
  clientKey: string;
}

export interface SourcePreviewDeps {
  fetch: FetchImpl;
  resolve?: Resolver;
  now?: () => number;
  log?: (message: string) => void;
  /** Replaced in tests so the preview engine is not exercised twice. */
  preview?: (url: string, fetchImpl: FetchImpl, signal: AbortSignal) => Promise<SourcePreview>;
  /** Asks Jev for the format; absent when the server has no key. It may be slow: the handler gives up after FORMAT_TIMEOUT_MS. */
  classify?: (preview: SourcePreview) => Promise<SourceFormat | null>;
}

const cache = new Map<string, { at: number; preview: FormattedPreview }>();
const asks = new Map<string, number[]>();

/** Empties the in-memory cache and counters. Tests call this between cases. */
export function resetSourcePreviewState(): void {
  cache.clear();
  asks.clear();
}

function fail(
  status: number,
  error: "invalid" | "unreachable" | "timeout" | "rate_limited",
  message: string,
  headers?: Record<string, string>,
): ApiResult<SourcePreviewBody> {
  return { status, body: { error, message }, headers: { "Cache-Control": "no-store", ...headers } };
}

function rateLimited(key: string, now: number): number | null {
  const recent = (asks.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    asks.set(key, recent);
    return Math.max(1, Math.ceil(((recent[0] ?? now) + RATE_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  asks.set(key, recent);
  if (asks.size > 1000) {
    for (const [client, times] of asks) {
      if (times.every((time) => now - time >= RATE_WINDOW_MS)) asks.delete(client);
    }
  }
  return null;
}

const defaultPreview: NonNullable<SourcePreviewDeps["preview"]> = (url, fetchImpl, signal) =>
  previewSource(url, { http: createPreviewHttp(fetchImpl), signal });

/** The preview with its format: Jev's answer within the time, else the type's rule. Never throws, never blocks. */
async function withFormat(
  preview: SourcePreview,
  classify: SourcePreviewDeps["classify"],
): Promise<FormattedPreview> {
  const rule = deriveSourceFormat(preview.type ?? "rss");
  // A type that decides its own format (video, releases, research, forum) is not asked about.
  if (!classify || rule !== "blog") return { ...preview, format: rule, format_by: "rule" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const jev = await Promise.race([
    classify(preview).catch(() => null),
    new Promise<null>((done) => {
      timer = setTimeout(() => done(null), FORMAT_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  return jev
    ? { ...preview, format: jev, format_by: "jev" }
    : { ...preview, format: rule, format_by: "rule" };
}

export async function handleSourcePreview(
  input: SourcePreviewInput,
  deps: SourcePreviewDeps,
): Promise<ApiResult<SourcePreviewBody>> {
  const now = (deps.now ?? Date.now)();

  let target: URL;
  try {
    if (input.rawUrl === null) throw new GuardError("invalid", "Give an address in ?url=.");
    target = parseTargetUrl(input.rawUrl);
  } catch (error) {
    return fail(
      400,
      "invalid",
      error instanceof GuardError ? error.message : "That is not a valid address.",
    );
  }

  const wait = rateLimited(input.clientKey, now);
  if (wait !== null) {
    return fail(429, "rate_limited", "Too many previews. Try again shortly.", {
      "Retry-After": String(wait),
    });
  }

  const key = target.toString();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { status: 200, headers: { "Cache-Control": "private, max-age=600" }, body: hit.preview };
  }

  const resolve = deps.resolve ?? resolveAll;
  try {
    await assertPublicHost(target, resolve);
  } catch (error) {
    return fail(
      400,
      "invalid",
      error instanceof GuardError ? error.message : "That host is not public.",
    );
  }

  try {
    const run = deps.preview ?? defaultPreview;
    const preview = await run(
      key,
      guardedFetch(deps.fetch, resolve),
      AbortSignal.timeout(OVERALL_TIMEOUT_MS),
    );
    const formatted = await withFormat(preview, deps.classify);
    cache.set(key, { at: now, preview: formatted });
    if (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return {
      status: 200,
      headers: { "Cache-Control": "private, max-age=600" },
      body: formatted,
    };
  } catch (error) {
    if (error instanceof PreviewError && error.code === "timeout") {
      return fail(504, "timeout", "The address took too long to answer.");
    }
    if (error instanceof PreviewError) return fail(422, "unreachable", error.message);
    // Only the kind of failure is logged: the address is the caller's, the message may echo it.
    deps.log?.(`The preview failed (${error instanceof Error ? error.name : "error"})`);
    return fail(422, "unreachable", "The address could not be read.");
  }
}
