import { Item, itemId, type Source } from "@dispatch/core";
import type { FetchWindow } from "../gate/fetchWindow.js";
import { canonicalizeUrl } from "./canonicalizeUrl.js";
import { collapseWhitespace, htmlToText } from "./htmlToText.js";
import { parseFeedDate } from "./parseDate.js";
import { capSnippet } from "./snippet.js";

/** What a fetcher extracts from one entry, before any cleaning. All text is untrusted. */
export interface RawItem {
  url: string | undefined;
  title: string | undefined;
  author?: string | undefined;
  /** A Date, or a string in any format feeds use. */
  publishedAt?: Date | string | undefined;
  /** HTML or text used for the snippet. Falls back to `content`. */
  summary?: string | undefined;
  /** HTML or text kept as full text for later extraction. */
  content?: string | undefined;
  signals?: Item["signals"] | undefined;
}

export interface BuildContext {
  source: Source;
  window: FetchWindow;
  fetchedAt: Date;
  /** Items without a date cannot be placed in the window. Dropped unless the source is a page scrape. */
  undated?: "keep" | "drop";
  /** Keep URL fragments in identity, for single-page changelogs whose entries are anchors. */
  keepFragment?: boolean;
}

/** Full text beyond this adds cost without helping a judge or writer. */
export const CONTENT_MAX = 20_000;
const CONTENT_MIN = 300;
const TITLE_MAX = 300;
/** Feeds stamp a few hours into the future when they mix time zones; more than a day is bogus. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function resolveUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value.trim()).toString();
  } catch {
    return undefined;
  }
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  return parseFeedDate(value);
}

/**
 * Turn one raw entry into an Item, or null when it has no title, no usable URL, falls outside
 * the window, or fails the core schema. Dropping is silent by design: one bad entry never fails a
 * source.
 */
export function buildItem(raw: RawItem, context: BuildContext): Item | null {
  const title = collapseWhitespace(htmlToText(raw.title ?? "")).slice(0, TITLE_MAX);
  if (title === "") return null;

  const url = resolveUrl(raw.url);
  if (!url) return null;
  const canonical = canonicalizeUrl(url, { keepFragment: context.keepFragment ?? false });
  if (!canonical) return null;

  const published = toDate(raw.publishedAt);
  if (published) {
    const { from, to } = context.window;
    if (published < from || published.getTime() > to.getTime() + FUTURE_TOLERANCE_MS) return null;
  } else if ((context.undated ?? "drop") === "drop") {
    return null;
  }

  const summaryText = raw.summary ? htmlToText(raw.summary) : "";
  const contentText = raw.content ? htmlToText(raw.content) : "";
  const snippet = capSnippet(summaryText || contentText);
  const author = raw.author ? collapseWhitespace(htmlToText(raw.author)).slice(0, 120) : "";
  const content = contentText.length >= CONTENT_MIN ? contentText.slice(0, CONTENT_MAX) : undefined;

  const parsed = Item.safeParse({
    id: itemId(canonical),
    url,
    canonical_url: canonical,
    title,
    source_id: context.source.id,
    source_type: context.source.type,
    ...(author ? { author } : {}),
    ...(published ? { published_at: published.toISOString() } : {}),
    fetched_at: context.fetchedAt.toISOString(),
    snippet,
    signals: raw.signals ?? {},
    ...(content ? { content } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** Build every entry, keeping order and dropping the ones that do not qualify. */
export function buildItems(raws: readonly RawItem[], context: BuildContext): Item[] {
  const items: Item[] = [];
  for (const raw of raws) {
    const item = buildItem(raw, context);
    if (item) items.push(item);
  }
  return items;
}
