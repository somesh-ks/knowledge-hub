import { parseHTML } from "linkedom";
import { FeedParseError, looksLikeFeed, type ParsedFeed, parseFeed } from "../fetch/feedParser.js";
import { type HttpClient, HttpError } from "../http.js";

export interface FeedLink {
  href: string;
  title: string | undefined;
  format: "rss" | "atom";
}

export interface DiscoverDeps {
  http: HttpClient;
  signal?: AbortSignal | undefined;
}

export type DiscoveryResult =
  | {
      status: "feed";
      feedUrl: string;
      format: ParsedFeed["format"];
      entries: number;
      via: "hint" | "page" | "link" | "probe";
      /** Set when most entries point off-site, as in a link roundup. */
      linkKind?: "newsletter-link";
      requests: number;
    }
  | { status: "none"; requests: number }
  /** The page itself is gone: 404, 410 or a name that no longer resolves. */
  | { status: "dead"; reason: string; requests: number }
  /** The page refused or failed for now; a scrape service may still reach it. */
  | { status: "blocked"; reason: string; requests: number };

/** Paths tried when a page advertises no feed, most common first. */
export const PROBE_PATHS = [
  "/feed",
  "/rss.xml",
  "/atom.xml",
  "/feed.xml",
  "/rss",
  "/atom",
  "/index.xml",
] as const;
const SECTION_PROBE_PATHS = [
  "/feed",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/rss",
] as const;

const MIN_ENTRIES_FOR_KIND = 5;
const OFF_SITE_SHARE = 0.7;
/** A roundup links to many sites; a blog that moved domains links to one other host. */
const MIN_OFF_SITE_HOSTS = 3;

/** Feed links advertised in a page's head: <link rel="alternate" type="application/rss+xml">. */
export function extractFeedLinks(html: string, baseUrl: string): FeedLink[] {
  const { document } = parseHTML(html);
  const links: FeedLink[] = [];
  for (const element of document.querySelectorAll("link[rel][href]")) {
    const rel = (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("alternate")) continue;
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    const format = type.includes("atom") ? "atom" : type.includes("rss") ? "rss" : undefined;
    if (!format) continue;
    const href = element.getAttribute("href");
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href.trim(), baseUrl).toString();
    } catch {
      continue;
    }
    links.push({ href: absolute, title: element.getAttribute("title") ?? undefined, format });
  }
  // Comment feeds are never what a reader wants; keep them last in case they are all there is.
  const isComments = (link: FeedLink): boolean =>
    /comment/i.test(`${link.title ?? ""} ${link.href}`);
  return [...links.filter((l) => !isComments(l)), ...links.filter(isComments)];
}

const FEED_PATH = /(^|\/)(rss|feed|atom)(\.xml|\.rss|\.atom)?\/?$/i;
const MAX_ANCHOR_CANDIDATES = 3;

/**
 * Feed addresses a page links from its body or footer without declaring them in the head, such as
 * a Mailchimp archive's /feed. Only anchors whose path looks like a feed count, which keeps
 * article links that merely carry utm_source=rss out. Comment feeds are skipped.
 */
export function extractAnchorFeedCandidates(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const found: string[] = [];
  for (const element of document.querySelectorAll("a[href]")) {
    const href = element.getAttribute("href");
    if (!href) continue;
    let absolute: URL;
    try {
      absolute = new URL(href.trim(), baseUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") continue;
    if (!FEED_PATH.test(absolute.pathname) || /comment/i.test(absolute.pathname)) continue;
    const url = absolute.toString();
    if (!found.includes(url)) found.push(url);
  }
  return found.slice(0, MAX_ANCHOR_CANDIDATES);
}

/** Common feed locations for a site, section path first, then the site root. */
export function probeUrls(pageUrl: string): string[] {
  const url = new URL(pageUrl);
  const section = url.pathname.replace(/\/+$/, "");
  const urls: string[] = [];
  if (section !== "")
    for (const path of SECTION_PROBE_PATHS) urls.push(`${url.origin}${section}${path}`);
  for (const path of PROBE_PATHS) urls.push(`${url.origin}${path}`);
  return [...new Set(urls)];
}

function registrableHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().split(".").slice(-2).join(".");
  } catch {
    return "";
  }
}

/** "newsletter-link" when most entries link to other sites: a roundup, not original writing. */
export function classifyLinkKind(feed: ParsedFeed, feedUrl: string): "newsletter-link" | undefined {
  const own = registrableHost(feedUrl);
  const links = feed.entries
    .map((entry) => entry.link)
    .filter((link): link is string => Boolean(link));
  if (links.length < MIN_ENTRIES_FOR_KIND) return undefined;
  const offSite = links.filter((link) => registrableHost(link) !== own);
  const hosts = new Set(offSite.map(registrableHost));
  return offSite.length / links.length >= OFF_SITE_SHARE && hosts.size >= MIN_OFF_SITE_HOSTS
    ? "newsletter-link"
    : undefined;
}

/** Error code of the first cause in the chain that carries one, such as ENOTFOUND. */
export function networkErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const code = (current as NodeJS.ErrnoException).code;
    if (typeof code === "string") return code;
    current = current.cause;
  }
  return undefined;
}

interface Probe {
  feedUrl: string;
  feed: ParsedFeed;
}

async function tryFeed(
  url: string,
  deps: DiscoverDeps,
  counter: { requests: number },
): Promise<Probe | undefined> {
  counter.requests++;
  try {
    const response = await deps.http.fetchText(url, {
      signal: deps.signal,
      retries: 0,
      timeoutMs: 10_000,
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5",
      },
    });
    if (!looksLikeFeed(response.text)) return undefined;
    const feed = parseFeed(response.text, response.url);
    return feed.entries.length > 0 ? { feedUrl: url, feed } : undefined;
  } catch (error) {
    if (error instanceof HttpError || error instanceof FeedParseError) return undefined;
    throw error;
  }
}

function found(
  probe: Probe,
  via: "hint" | "page" | "link" | "probe",
  requests: number,
): DiscoveryResult {
  const linkKind = classifyLinkKind(probe.feed, probe.feedUrl);
  return {
    status: "feed",
    feedUrl: probe.feedUrl,
    format: probe.feed.format,
    entries: probe.feed.entries.length,
    via,
    ...(linkKind ? { linkKind } : {}),
    requests,
  };
}

/**
 * Find and verify the feed of a page. Order: an address believed correct (`hint`), the page
 * itself when it is a feed, feeds the page advertises, feed-looking links in its body, then common paths. A candidate counts
 * only if it downloads and parses with at least one entry, which rejects HTML that a single-page
 * app serves for every path. Politely sequential: at most about a dozen requests per site.
 */
export async function discoverFeed(
  pageUrl: string,
  deps: DiscoverDeps,
  hint?: string,
): Promise<DiscoveryResult> {
  const counter = { requests: 0 };

  if (hint) {
    const probe = await tryFeed(hint, deps, counter);
    if (probe) return found(probe, "hint", counter.requests);
  }

  counter.requests++;
  let html: string;
  let finalUrl: string;
  try {
    const page = await deps.http.fetchText(pageUrl, {
      signal: deps.signal,
      retries: 1,
      timeoutMs: 12_000,
    });
    html = page.text;
    finalUrl = page.url;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404 || error.status === 410) {
        return { status: "dead", reason: `HTTP ${error.status}`, requests: counter.requests };
      }
      const code = networkErrorCode(error);
      // ENOTFOUND is a definite answer; EAI_AGAIN means the resolver itself was unavailable.
      if (code === "ENOTFOUND") {
        return { status: "dead", reason: "host does not resolve", requests: counter.requests };
      }
      if (code === "EAI_AGAIN") {
        return { status: "blocked", reason: "temporary DNS failure", requests: counter.requests };
      }
      // Blocked or failing pages may still serve a feed at a standard path.
      const probe = await probeCommonPaths(pageUrl, deps, counter);
      if (probe) return found(probe, "probe", counter.requests);
      return { status: "blocked", reason: error.message, requests: counter.requests };
    }
    throw error;
  }

  if (looksLikeFeed(html)) {
    try {
      const feed = parseFeed(html, finalUrl);
      if (feed.entries.length > 0)
        return found({ feedUrl: pageUrl, feed }, "page", counter.requests);
    } catch {
      // Fall through to the HTML strategies.
    }
  }

  for (const link of extractFeedLinks(html, finalUrl)) {
    const probe = await tryFeed(link.href, deps, counter);
    if (probe) return found(probe, "link", counter.requests);
  }

  for (const candidate of extractAnchorFeedCandidates(html, finalUrl)) {
    const probe = await tryFeed(candidate, deps, counter);
    if (probe) return found(probe, "link", counter.requests);
  }

  const probe = await probeCommonPaths(finalUrl, deps, counter);
  if (probe) return found(probe, "probe", counter.requests);
  return { status: "none", requests: counter.requests };
}

async function probeCommonPaths(
  pageUrl: string,
  deps: DiscoverDeps,
  counter: { requests: number },
): Promise<Probe | undefined> {
  for (const url of probeUrls(pageUrl)) {
    const probe = await tryFeed(url, deps, counter);
    if (probe) return probe;
  }
  return undefined;
}

const CHANNEL_ID = /UC[\w-]{22}/;

const CHANNEL_PATH = /^\/channel\/(UC[\w-]{22})/;

/** The channel id YouTube's own resolver gives a handle or custom name: a small answer, no page. */
async function resolveViaApi(handleUrl: string, deps: DiscoverDeps): Promise<string | undefined> {
  const answer = (await deps.http.postJson(
    "https://www.youtube.com/youtubei/v1/navigation/resolve_url",
    {
      url: handleUrl,
      context: { client: { clientName: "WEB", clientVersion: "2.20241001.00.00", hl: "en" } },
    },
    { signal: deps.signal, headers: { "user-agent": "Mozilla/5.0" } },
  )) as { endpoint?: { browseEndpoint?: { browseId?: unknown } } };
  const id = answer.endpoint?.browseEndpoint?.browseId;
  return typeof id === "string" && /^UC[\w-]{22}$/.test(id) ? id : undefined;
}

/**
 * YouTube channel id from a channel address, without an API key. A /channel/UC... address holds it;
 * a handle or custom name goes to YouTube's resolver, which answers in about 1 KB. The channel page
 * is the last resort: it is over 1 MB, so the preview's size cap refuses it. It reads the advertised
 * feed link or the canonical channel link, with the consent cookie that avoids the EU interstitial.
 */
export async function resolveYoutubeChannel(
  handleUrl: string,
  deps: DiscoverDeps,
): Promise<string | undefined> {
  const direct = CHANNEL_PATH.exec(new URL(handleUrl).pathname)?.[1];
  if (direct) return direct;
  const resolved = await resolveViaApi(handleUrl, deps).catch(() => undefined);
  if (resolved) return resolved;
  const page = await deps.http.fetchText(handleUrl, {
    signal: deps.signal,
    retries: 1,
    headers: { cookie: "CONSENT=YES+1; SOCS=CAI", "accept-language": "en-US,en;q=0.8" },
  });
  const fromFeedLink = extractFeedLinks(page.text, page.url)
    .map((link) => /channel_id=(UC[\w-]{22})/.exec(link.href)?.[1])
    .find((id) => id !== undefined);
  if (fromFeedLink) return fromFeedLink;
  const canonical =
    /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(
      page.text,
    );
  if (canonical?.[1]) return canonical[1];
  const embedded = /"(?:channelId|externalId|browseId)":"(UC[\w-]{22})"/.exec(page.text);
  return embedded?.[1] ?? CHANNEL_ID.exec(new URL(handleUrl).pathname)?.[0];
}
