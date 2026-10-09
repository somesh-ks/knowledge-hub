import { scoreLabel } from "@dispatch/core";
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
 * lively it is, and a quality score from 0 to 5 for a source that has no history yet.
 *
 * The rubric (a page with no feed is capped at 3, in practice about 1.8):
 * - reachable 1.0, a valid feed 0.7, https 0.5, a clear title 0.3;
 * - freshness up to 1.3 by the newest post: within 7 days full, 30 days 0.7, 90 days 0.3;
 * - frequency up to 1.2 by posts in the last 30 days: 2 to 20 is full, 1 earns 0.4, 21 to 40
 *   half, and a flood beyond that is noise and earns 0.2.
 */
export const PREVIEW_TIMEOUT_MS = 6_000;
export const PREVIEW_MAX_BYTES = 1024 * 1024;
const PAGE_ONLY_CAP = 3;
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
  score: number;
  score_label: "Excellent" | "Good" | "Fair" | "Poor";
  reason: string;
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
  hasTitle: boolean;
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

/** The no-history rubric in the header comment. Returns a score, its label and a sentence. */
export function scorePreview(input: PreviewScoreInput): {
  score: number;
  label: SourcePreview["score_label"];
  reason: string;
} {
  let total = 1 + (input.https ? 0.5 : 0) + (input.hasTitle ? 0.3 : 0);
  if (input.hasFeed) {
    total +=
      0.7 +
      1.3 * freshnessFactor(input.latestAt, input.now) +
      1.2 * frequencyFactor(input.items30d);
  } else {
    total = Math.min(PAGE_ONLY_CAP, total);
  }
  const score = Math.round(Math.min(5, total) * 10) / 10;
  return { score, label: scoreLabel(score), reason: previewReason(input) };
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
  const http = limitHttp(deps.http);
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
    if (isTimeout(error) || isTimeout(pageError)) {
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
  let meta: PageMeta | undefined;
  if (page && !pageIsFeed) {
    meta = parsePageMeta(page.text, base);
  } else if (pageIsFeed) {
    try {
      const home = await http.fetchText(`${origin}/`, { signal: deps.signal });
      meta = parsePageMeta(home.text, home.url);
    } catch {
      meta = undefined;
    }
  }

  let feed: ParsedFeed | undefined;
  if (source.feed_url) {
    try {
      const text =
        pageIsFeed && page
          ? page.text
          : (await http.fetchText(source.feed_url, { signal: deps.signal })).text;
      feed = parseFeed(text, source.feed_url);
    } catch {
      feed = undefined;
    }
  }

  let favicon = meta?.iconUrl ?? null;
  if (!favicon) {
    try {
      await http.fetchText(`${origin}/favicon.ico`, { signal: deps.signal });
      favicon = `${origin}/favicon.ico`;
    } catch {
      favicon = null;
    }
  }

  const host = hostLabel(url);
  const name = feed?.title?.trim() || meta?.siteName || registrableName(host);
  const activity = feed ? feedActivity(feed, now) : undefined;
  const rated = scorePreview({
    hasFeed: feed !== undefined,
    https: new URL(base).protocol === "https:",
    hasTitle: Boolean(feed?.title?.trim() || meta?.siteName || meta?.title),
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
    reason: rated.reason,
  };
}
