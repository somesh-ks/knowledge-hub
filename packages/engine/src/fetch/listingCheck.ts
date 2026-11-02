import { createHash } from "node:crypto";
import type { ListingFingerprintsFile, Source } from "@singularity/core";
import type { HttpClient } from "../http.js";

/** Fewer links than this and the page is built in the browser: its fingerprint says nothing. */
export const MIN_LISTING_LINKS = 3;
/** A fingerprint older than this is not trusted, so a page that changes without its links still gets read. */
export const FORCE_SCRAPE_DAYS = 7;
/** The direct read is a probe, not a scrape: a slow or large page is not worth waiting for. */
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_BYTES = 2_000_000;
const DAY_MS = 86_400_000;
const ANCHOR = /<a\b([^>]*)>/gi;
/** The exact `href` attribute: never `data-href`, whatever order they come in. */
const HREF_ATTR = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** A link as the fingerprint holds it: absolute, without query or fragment. Null for a non-page link. */
export function cutLink(href: string, pageUrl: string): string | null {
  const text = href.trim();
  if (text === "" || text.startsWith("#") || /^(mailto|tel|javascript):/i.test(text)) return null;
  try {
    const resolved = new URL(text, pageUrl);
    if (resolved.protocol !== "https:" && resolved.protocol !== "http:") return null;
    resolved.hash = "";
    resolved.search = "";
    return resolved.href;
  } catch {
    return null;
  }
}

/** Every distinct link of a page's anchors, cut and sorted, so a reshuffled listing is not a change. */
export function pageLinks(html: string, pageUrl: string): string[] {
  const links = new Set<string>();
  for (const anchor of html.matchAll(ANCHOR)) {
    const attr = HREF_ATTR.exec(anchor[1] ?? "");
    const link = cutLink(attr?.[1] ?? attr?.[2] ?? "", pageUrl);
    if (link !== null) links.add(link);
  }
  return [...links].sort();
}

/** A short hash of a page's links; null under three links, which means the list is drawn by script. */
export function fingerprintLinks(html: string, pageUrl: string): string | null {
  const links = pageLinks(html, pageUrl);
  return links.length < MIN_LISTING_LINKS ? null : hashLinks(links);
}

const hashLinks = (links: readonly string[]): string =>
  createHash("sha256").update(links.join("\n")).digest("hex").slice(0, 16);

/**
 * True when the page's links hold at least one of the articles the scrape found. Three stable
 * navigation links pass the minimum above on a page that draws its articles in the browser; a
 * fingerprint of those would never move, so it is kept only when it covers a real article.
 */
export function coversEntries(links: ReadonlySet<string>, entryUrls: readonly string[]): boolean {
  return entryUrls.some((url) => {
    const cut = cutLink(url, url);
    return cut !== null && links.has(cut);
  });
}

/**
 * What the last scrape of each listing page saw, and what this run's scrapes saw since. Held in
 * memory for the fetch stage, which writes the result to state/listing-fingerprints.json.
 */
export class ListingMemory {
  private readonly sources: ListingFingerprintsFile["sources"];

  constructor(initial: ListingFingerprintsFile) {
    this.sources = { ...initial.sources };
  }

  /** True when the page's links match the last scrape and that scrape is recent enough to trust. */
  unchanged(sourceId: string, hash: string, now: Date): boolean {
    const known = this.sources[sourceId];
    if (!known || known.hash !== hash) return false;
    return now.getTime() - Date.parse(known.scraped_at) < FORCE_SCRAPE_DAYS * DAY_MS;
  }

  /** Called only after a scrape of the page succeeded, so a failed scrape is tried again next run. */
  remember(sourceId: string, hash: string, now: Date): void {
    this.sources[sourceId] = { hash, scraped_at: now.toISOString() };
  }

  /** The file to store, keeping only sources that are still configured. */
  toFile(configured: readonly Pick<Source, "id">[]): ListingFingerprintsFile {
    const keep = new Set(configured.map((source) => source.id));
    const sources: ListingFingerprintsFile["sources"] = {};
    for (const [id, entry] of Object.entries(this.sources)) if (keep.has(id)) sources[id] = entry;
    return { version: 1, sources };
  }
}

export interface ListingProbe {
  /** The page's fingerprint, or null when the direct read failed or the page told us nothing. */
  hash: string | null;
  /** The links behind the fingerprint, for checking that it covers the scrape's articles. */
  links: ReadonlySet<string> | null;
  /** True when the links match the last scrape, so the scrape can be skipped. */
  unchanged: boolean;
}

const NO_PROBE: ListingProbe = { hash: null, links: null, unchanged: false };

/**
 * Read the page directly, which costs no credit, and compare its links with the last scrape's. Any
 * trouble (a refusal, a timeout, a page built in the browser) gives no fingerprint, and the caller
 * scrapes as it always did: the check can cost a credit it might have saved, never an article.
 */
export async function probeListing(
  memory: ListingMemory,
  source: Pick<Source, "id">,
  pageUrl: string,
  http: HttpClient,
  now: Date,
  signal?: AbortSignal,
): Promise<ListingProbe> {
  try {
    const page = await http.fetchText(pageUrl, {
      ...(signal ? { signal } : {}),
      timeoutMs: PROBE_TIMEOUT_MS,
      maxBytes: PROBE_MAX_BYTES,
      retries: 0,
    });
    if (page.status >= 400) return NO_PROBE;
    const links = pageLinks(page.text, page.url || pageUrl);
    if (links.length < MIN_LISTING_LINKS) return NO_PROBE;
    const hash = hashLinks(links);
    return { hash, links: new Set(links), unchanged: memory.unchanged(source.id, hash, now) };
  } catch {
    return NO_PROBE;
  }
}
