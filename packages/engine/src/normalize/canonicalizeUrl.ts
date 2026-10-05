const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "yclid",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "mkt_tok",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "vero_conv",
]);

const TRACKING_PREFIXES = ["utm_", "mc_", "hsa_", "pk_", "mtm_"];

/** Path segments that mark a redirect or click-tracking endpoint. */
const REDIRECT_SEGMENTS = new Set([
  "redirect",
  "out",
  "away",
  "url",
  "goto",
  "go",
  "click",
  "exit",
  "outbound",
  "r",
  "l",
  "link",
  "l.php",
  "redir",
]);

/** Query parameters that can carry the real destination of a redirect endpoint. */
const REDIRECT_PARAMS = [
  "url",
  "u",
  "q",
  "target",
  "dest",
  "destination",
  "redirect",
  "to",
  "href",
  "uddg",
  "link",
];

/** Hosts that only exist to wrap other links, so any path counts. */
const WRAPPER_HOSTS = new Set([
  "l.facebook.com",
  "lm.facebook.com",
  "l.instagram.com",
  "slack-redir.net",
  "href.li",
]);

const MAX_UNWRAP_DEPTH = 3;

export interface CanonicalizeOptions {
  /** Keep the fragment. Only for single-page changelogs whose entries are anchors. */
  keepFragment?: boolean;
}

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The destination of a known redirect wrapper, or null when the URL is not one. */
export function unwrapRedirect(url: URL): URL | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter((s) => s !== "");
  const lastSegment = segments.at(-1)?.toLowerCase() ?? "";
  const looksLikeRedirect =
    WRAPPER_HOSTS.has(host) ||
    (segments.length > 0 && segments.length <= 2 && REDIRECT_SEGMENTS.has(lastSegment));
  if (!looksLikeRedirect) return null;
  for (const name of REDIRECT_PARAMS) {
    const value = url.searchParams.get(name);
    if (value === null) continue;
    const target = parseHttpUrl(value);
    if (target) return target;
  }
  // Wrappers such as https://href.li/?https://example.com carry the target as the bare query.
  if (WRAPPER_HOSTS.has(host)) {
    const bare = parseHttpUrl(safeDecode(url.search.replace(/^\?/, "")));
    if (bare) return bare;
  }
  return null;
}

/**
 * Stable form of a URL for identity: same article, same string. Returns null when the input is
 * not an http(s) URL. Item ids are hashed from this value, so changing the rules re-surfaces
 * old items; extend with care.
 */
export function canonicalizeUrl(input: string, options: CanonicalizeOptions = {}): string | null {
  let url = parseHttpUrl(input);
  if (!url) return null;

  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    const inner = unwrapRedirect(url);
    if (!inner) break;
    url = inner;
  }

  // The URL parser lowercases the host and drops default ports; credentials never belong in ids.
  url.username = "";
  url.password = "";

  const kept: [string, string][] = [];
  for (const [name, value] of url.searchParams) {
    if (!isTrackingParam(name)) kept.push([name, value]);
  }
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const search = kept.length
    ? `?${kept.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&")}`
    : "";

  // Only trailing slashes are removed; the root path becomes empty so "/" and "" agree.
  const path = url.pathname.replace(/\/+$/, "");
  const fragment = options.keepFragment && url.hash.length > 1 ? url.hash : "";
  return `${url.protocol}//${url.host}${path}${search}${fragment}`;
}
