import { combineScoreParts, type ScoreLabel, scoreLabel } from "@dispatch/core";
import { parseHTML } from "linkedom";
import { looksLikeFeed, type ParsedFeed, parseFeed } from "../fetch/feedParser.js";
import {
  createHttpClient,
  type FetchImpl,
  type HttpClient,
  HttpError,
  type RequestOptions,
  type TextResponse,
} from "../http.js";
import { AddSourceError, buildSourceFromUrl, hostLabel } from "./addSource.js";

/**
 * A look at a web address before it is followed: what outlet it is, whether it has a feed, how
 * lively it is, and a score for a source that has no history yet. The score is on the same 0 to 3
 * scale, with the same three parts of 0 to 1 and the same labels, as the score of a source with a
 * record (sourceScore in @dispatch/core), measured from what one look can see:
 * - Health, from the feed: a valid feed earns 0.4 and the newest post up to 0.6 (within 7 days
 *   full, 30 days 0.7 of it, 90 days 0.3, older or undated nothing). A page with no feed earns
 *   PAGE_ONLY_HEALTH: it can be read, but there is no feed to follow.
 * - Quality: how often the feed posts, up to 0.8 (posts in the last 30 days: 2 to 20 is full, 1
 *   earns 0.4 of it, 21 to 40 half, and a flood beyond that is noise and earns 0.2), and a clear
 *   title, 0.2.
 * - Trust: served over https, 0.6, and a site that names itself (a feed title or og:site_name, not
 *   a name guessed from the host), 0.4. A page with no feed is capped at PAGE_ONLY_TRUST_CAP, three
 *   fifths of the part, as such a page was capped at three fifths of the old score: nothing it
 *   sends can be read before it is fetched. Unlike a record's trust, this one is always measured.
 *
 * Each part is rounded to two decimals and they combine as a record's do, by the geometric mean:
 * score = 3 × cbrt(health × quality × trust), rounded to one decimal. A page with no feed scores
 * low but, with a title, not 0.
 */
export const PREVIEW_TIMEOUT_MS = 6_000;
export const PREVIEW_MAX_BYTES = 1024 * 1024;
export const PAGE_ONLY_HEALTH = 0.3;
export const PAGE_ONLY_TRUST_CAP = 0.6;
const DAY_MS = 86_400_000;

export type PreviewFailure = "unreachable" | "timeout";

export class PreviewError extends Error {
  constructor(
    readonly code: PreviewFailure,
    message: string,
  ) {
    super(message);
    this.name = "PreviewError";
  }
}

export interface SourcePreview {
  url: string;
  name: string;
  host: string;
  favicon_url: string | null;
  thumbnail_url: string | null;
  feed_url: string | null;
  kind: "feed" | "page";
  latest_at: string | null;
  items_30d: number | null;
  /** 0 to 3 with one decimal. */
  score: number;
  score_label: ScoreLabel;
  /**
   * The three parts of the score, each 0 to 1 with two decimals; the score is 3 times their
   * geometric mean.
   */
  score_parts: PreviewScoreParts;
  reason: string;
}

/** A preview's three parts. Unlike a record's, its trust is always a number. */
export interface PreviewScoreParts {
  health: number;
  quality: number;
  trust: number;
}

// ------------------------------------------------------------------------------------ pure parsing

export interface PageMeta {
  siteName: string | undefined;
  title: string | undefined;
  iconUrl: string | undefined;
  imageUrl: string | undefined;
}

function absolute(href: string | null | undefined, base: string): string | undefined {
  if (!href?.trim()) return undefined;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Site name, title, icon and share image from a page's head. Addresses come back absolute. */
export function parsePageMeta(html: string, baseUrl: string): PageMeta {
  const { document } = parseHTML(html);
  const meta = (property: string): string | undefined => {
    const element =
      document.querySelector(`meta[property="${property}"]`) ??
      document.querySelector(`meta[name="${property}"]`);
    return element?.getAttribute("content")?.trim() || undefined;
  };
  let icon: string | undefined;
  let touchIcon: string | undefined;
  for (const link of document.querySelectorAll("link[rel][href]")) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    const href = absolute(link.getAttribute("href"), baseUrl);
    if (!href) continue;
    if (rel.includes("icon") && !icon) icon = href;
    else if (rel.includes("apple-touch-icon") && !touchIcon) touchIcon = href;
  }
  return {
    siteName: meta("og:site_name"),
    title: document.querySelector("title")?.textContent?.trim() || meta("og:title"),
    iconUrl: icon ?? touchIcon,
    imageUrl: absolute(meta("og:image"), baseUrl),
  };
}

/** "blog.example.co.uk" becomes "Example", "www.stripe.com" becomes "Stripe". */
export function registrableName(host: string): string {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length === 0) return host;
  let index = labels.length - 2;
  const second = labels[labels.length - 2];
  const last = labels[labels.length - 1];
  if (labels.length >= 3 && last?.length === 2 && second && second.length <= 3) index -= 1;
  const label = labels[Math.max(0, index)] ?? labels[0] ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface FeedActivity {
  latestAt: string | null;
  items30d: number;
}

/** Newest post date and the number of posts dated within 30 days before `now`. */
export function feedActivity(feed: ParsedFeed, now: Date): FeedActivity {
  let latest = Number.NEGATIVE_INFINITY;
  let recent = 0;
  for (const entry of feed.entries) {
    const at = Date.parse(entry.published ?? entry.updated ?? "");
    if (Number.isNaN(at) || at > now.getTime() + DAY_MS) continue;
    if (at > latest) latest = at;
    if (now.getTime() - at <= 30 * DAY_MS) recent++;
  }
  return {
    latestAt: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
    items30d: recent,
  };
}

export interface PreviewScoreInput {
  hasFeed: boolean;
  https: boolean;
  /** The feed or the page has a title of any kind. */
  hasTitle: boolean;
  /** The site names itself: a feed title or og:site_name, not a name guessed from the host. */
  named: boolean;
  latestAt: string | null;
  items30d: number | null;
  now: Date;
}

function freshnessFactor(latestAt: string | null, now: Date): number {
  if (!latestAt) return 0;
  const days = (now.getTime() - Date.parse(latestAt)) / DAY_MS;
  if (days <= 7) return 1;
  if (days <= 30) return 0.7;
  if (days <= 90) return 0.3;
  return 0;
}

function frequencyFactor(items: number | null): number {
  if (items === null || items <= 0) return 0;
  if (items === 1) return 0.4;
  if (items <= 20) return 1;
  if (items <= 40) return 0.5;
  return 0.2;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The no-history rubric in the header comment: a 0 to 3 score, its label, parts and a sentence. */
export function scorePreview(input: PreviewScoreInput): {
  score: number;
  label: SourcePreview["score_label"];
  parts: PreviewScoreParts;
  reason: string;
} {
  // What the feed shows counts only when there is a feed.
  const health = input.hasFeed
    ? 0.4 + 0.6 * freshnessFactor(input.latestAt, input.now)
    : PAGE_ONLY_HEALTH;
  const frequency = input.hasFeed ? frequencyFactor(input.items30d) : 0;
  const quality = 0.8 * frequency + (input.hasTitle ? 0.2 : 0);
  const trust = (input.https ? 0.6 : 0) + (input.named ? 0.4 : 0);
  const parts: PreviewScoreParts = {
    health: round2(health),
    quality: round2(quality),
    trust: round2(input.hasFeed ? trust : Math.min(PAGE_ONLY_TRUST_CAP, trust)),
  };
  const score = combineScoreParts([parts.health, parts.quality, parts.trust]);
  return { score, label: scoreLabel(score), parts, reason: previewReason(input) };
}

function previewReason(input: PreviewScoreInput): string {
  if (!input.hasFeed) return "No feed found, so only the page itself can be read.";
  const items = input.items30d ?? 0;
  const posts =
    items === 0
      ? "no posts in the last 30 days"
      : `${items} ${items === 1 ? "post" : "posts"} in the last 30 days`;
  const note = items > 40 ? " (a flood, likely noise)" : "";
  let latest = "no dated posts";
  if (input.latestAt) {
    const days = Math.max(
      0,
      Math.floor((input.now.getTime() - Date.parse(input.latestAt)) / DAY_MS),
    );
    latest = days === 0 ? "latest today" : `latest ${days} ${days === 1 ? "day" : "days"} ago`;
  }
  const https = input.https ? "" : ", not served over https";
  return `Valid feed, ${posts}${note}, ${latest}${https}.`;
}

// ------------------------------------------------------------------------------------------ fetching

/** An HTTP client for previews: one attempt, 6 second timeout, 1 MB cap, whatever the caller asks. */
export function createPreviewHttp(fetchImpl?: FetchImpl): HttpClient {
  const inner = createHttpClient({
    ...(fetchImpl ? { fetchImpl } : {}),
    retries: 0,
    timeoutMs: PREVIEW_TIMEOUT_MS,
    maxBytes: PREVIEW_MAX_BYTES,
  });
  return limitHttp(inner);
}

/** Wraps a client so every request uses the preview timeout and size cap. */
export function limitHttp(inner: HttpClient): HttpClient {
  const limit = (options: RequestOptions = {}): RequestOptions => ({
    ...options,
    retries: 0,
    timeoutMs: PREVIEW_TIMEOUT_MS,
    maxBytes: PREVIEW_MAX_BYTES,
  });
  return {
    fetchText: (url, options) => inner.fetchText(url, limit(options)),
    getJson: (url, options) => inner.getJson(url, limit(options)),
    postJson: (url, body, options) => inner.postJson(url, body, limit(options)),
  };
}

/**
 * Wraps a client so each address is fetched once: a second ask for the same address gets the
 * first answer (or failure), even while it is still on its way. A preview and the feed discovery
 * it runs read the same page and feed, so this halves their requests. Only addresses the inner
 * client (and whatever guard it carries) already fetched are answered from memory.
 */
export function onceHttp(inner: HttpClient): HttpClient {
  const seen = new Map<string, Promise<TextResponse>>();
  return {
    fetchText: (url, options) => {
      let pending = seen.get(url);
      if (pending === undefined) {
        pending = inner.fetchText(url, options);
        seen.set(url, pending);
      }
      return pending;
    },
    getJson: (url, options) => inner.getJson(url, options),
    postJson: (url, body, options) => inner.postJson(url, body, options),
  };
}

export interface PreviewDeps {
  http: HttpClient;
  now?: Date | undefined;
  signal?: AbortSignal | undefined;
}

function isTimeout(error: unknown): boolean {
  return error instanceof HttpError && /timed out/i.test(error.message);
}

export async function previewSource(url: string, deps: PreviewDeps): Promise<SourcePreview> {
  const now = deps.now ?? new Date();
  const http = onceHttp(limitHttp(deps.http));
  const discover = { http, signal: deps.signal };

  let page: TextResponse | undefined;
  let pageError: unknown;
  try {
    page = await http.fetchText(url, { signal: deps.signal });
  } catch (error) {
    pageError = error;
  }

  let source: Awaited<ReturnType<typeof buildSourceFromUrl>>;
  try {
    source = await buildSourceFromUrl(
      { url, origin: "manual", takenIds: new Set(), existing: [] },
      discover,
    );
  } catch (error) {
    if (isTimeout(error) || isTimeout(pageError) || deps.signal?.aborted) {
      throw new PreviewError("timeout", "The address took too long to answer.");
    }
    if (error instanceof AddSourceError) throw new PreviewError("unreachable", error.message);
    throw new PreviewError("unreachable", "The address could not be read.");
  }
  if (!page && !source.feed_url) {
    if (isTimeout(pageError)) {
      throw new PreviewError("timeout", "The address took too long to answer.");
    }
    throw new PreviewError("unreachable", "The address could not be read.");
  }

  const pageIsFeed = page !== undefined && looksLikeFeed(page.text);
  const base = page?.url ?? url;
  const origin = new URL(base).origin;

  // Page meta comes from the page; a feed address has none, so read the site's home page instead.
  const pageMeta = page && !pageIsFeed ? parsePageMeta(page.text, base) : undefined;
  const feedUrl = source.feed_url;
  // The home page, the feed and the favicon do not wait on each other. The favicon is looked for
  // only when the page names no icon; for a feed address, beside the home page that may name one.
  const [homeMeta, feed, faviconFound] = await Promise.all([
    pageIsFeed
      ? http
          .fetchText(`${origin}/`, { signal: deps.signal })
          .then((home) => parsePageMeta(home.text, home.url))
          .catch(() => undefined)
      : Promise.resolve(undefined),
    feedUrl
      ? (pageIsFeed && page
          ? Promise.resolve(page.text)
          : http.fetchText(feedUrl, { signal: deps.signal }).then((response) => response.text)
        )
          .then((text): ParsedFeed | undefined => parseFeed(text, feedUrl))
          .catch(() => undefined)
      : Promise.resolve(undefined),
    pageMeta?.iconUrl
      ? Promise.resolve(false)
      : http
          .fetchText(`${origin}/favicon.ico`, { signal: deps.signal })
          .then(() => true)
          .catch(() => false),
  ]);
  const meta: PageMeta | undefined = pageMeta ?? homeMeta;
  const favicon = meta?.iconUrl ?? (faviconFound ? `${origin}/favicon.ico` : null);

  const host = hostLabel(url);
  const name = feed?.title?.trim() || meta?.siteName || registrableName(host);
  const activity = feed ? feedActivity(feed, now) : undefined;
  const rated = scorePreview({
    hasFeed: feed !== undefined,
    https: new URL(base).protocol === "https:",
    hasTitle: Boolean(feed?.title?.trim() || meta?.siteName || meta?.title),
    named: Boolean(feed?.title?.trim() || meta?.siteName),
    latestAt: activity?.latestAt ?? null,
    items30d: activity?.items30d ?? null,
    now,
  });

  return {
    url,
    name,
    host,
    favicon_url: favicon,
    thumbnail_url: meta?.imageUrl ?? null,
    feed_url: feed ? source.feed_url : null,
    kind: feed ? "feed" : "page",
    latest_at: activity?.latestAt ?? null,
    items_30d: activity ? activity.items30d : null,
    score: rated.score,
    score_label: rated.label,
    score_parts: rated.parts,
    reason: rated.reason,
  };
}
