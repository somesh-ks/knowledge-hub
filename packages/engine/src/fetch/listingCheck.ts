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
const HREF = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * A fingerprint of a page's article links: every link to another page, resolved against the page
 * and cut at its query and fragment, then sorted so a reshuffled listing is not a change. Null
 * when the page holds fewer than three, which means the list is drawn by script.
 */
export function fingerprintLinks(html: string, pageUrl: string): string | null {
  const links = new Set<string>();
  for (const match of html.matchAll(HREF)) {
    const href = (match[1] ?? match[2] ?? "").trim();
    if (href === "" || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "https:" && resolved.protocol !== "http:") continue;
    resolved.hash = "";
    resolved.search = "";
    links.add(resolved.href);
  }
  if (links.size < MIN_LISTING_LINKS) return null;
  return createHash("sha256")
    .update([...links].sort().join("\n"))
    .digest("hex")
    .slice(0, 16);
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
  /** True when the links match the last scrape, so the scrape can be skipped. */
  unchanged: boolean;
}

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
    if (page.status >= 400) return { hash: null, unchanged: false };
    const hash = fingerprintLinks(page.text, page.url || pageUrl);
    if (hash === null) return { hash: null, unchanged: false };
    return { hash, unchanged: memory.unchanged(source.id, hash, now) };
  } catch {
    return { hash: null, unchanged: false };
  }
}
