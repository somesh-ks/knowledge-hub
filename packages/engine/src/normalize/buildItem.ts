import { type Category, Item, itemId, type Source } from "@singularity/core";
import type { FetchWindow } from "../gate/fetchWindow.js";
import { canonicalizeUrl } from "./canonicalizeUrl.js";
import { collapseWhitespace, htmlToText } from "./htmlToText.js";
import { parseFeedDate } from "./parseDate.js";
import { capSnippet } from "./snippet.js";

/** What a fetcher extracts from one entry, before any cleaning. All text is untrusted. */
export interface RawItem {
  url: string | undefined;
  title: string | undefined;
  /** Stable entry id from the source (feed guid), used only to tell apart entries that share a URL. */
  guid?: string | undefined;
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
  /** Hint of the discovery query that found these entries, copied onto each item. */
  categoryHint?: Category | undefined;
  /** Custom topics of the discovery query that found these entries. */
  topicIds?: readonly string[] | undefined;
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
export function buildItem(raw: RawItem, context: BuildContext, shared?: SharedUrl): Item | null {
  const title = collapseWhitespace(htmlToText(raw.title ?? "")).slice(0, TITLE_MAX);
  if (title === "") return null;

  const url = resolveUrl(raw.url);
  if (!url) return null;
  const canonical = canonicalizeUrl(url, {
    keepFragment: (context.keepFragment ?? false) || shared?.mode === "fragment",
  });
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

  // Topics of the source and of the query that found the entry; either one tags the item.
  const topicIds = [...new Set([...(context.source.topic_ids ?? []), ...(context.topicIds ?? [])])];
  const parsed = Item.safeParse({
    id: itemId(
      shared?.mode === "salt"
        ? `${canonical}
${shared.useTitle ? title : raw.guid?.trim() || title}`
        : canonical,
    ),
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
    ...(context.categoryHint ? { category_hint: context.categoryHint } : {}),
    ...(topicIds.length > 0 ? { topic_ids: topicIds } : {}),
    ...(content ? { content } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** How an entry that shares its canonical URL with another story of the same fetch gets its own id. */
interface SharedUrl {
  mode: "fragment" | "salt";
  /** The guid is empty or repeats within the group, so the title tells the entries apart. */
  useTitle: boolean;
}

/**
 * Entries of one fetch whose titles differ but whose canonical URLs match (anchors on a changelog,
 * a feed that links every item to its home page) would share one id, like and vote. Keep the
 * fragment when their raw fragments all differ; otherwise salt the id with the guid or title.
 * Entries that do not collide keep the id of the canonical URL alone.
 */
function sharedUrlModes(raws: readonly RawItem[], context: BuildContext): Map<RawItem, SharedUrl> {
  const modes = new Map<RawItem, SharedUrl>();
  if (context.keepFragment) return modes;
  const groups = new Map<string, { raw: RawItem; title: string; fragment: string }[]>();
  for (const raw of raws) {
    const url = resolveUrl(raw.url);
    const canonical = url ? canonicalizeUrl(url) : null;
    if (!url || !canonical) continue;
    const title = collapseWhitespace(htmlToText(raw.title ?? "")).slice(0, TITLE_MAX);
    const group = groups.get(canonical) ?? [];
    group.push({ raw, title, fragment: new URL(url).hash });
    groups.set(canonical, group);
  }
  for (const group of groups.values()) {
    if (new Set(group.map((entry) => entry.title)).size < 2) continue;
    const fragments = group.map((entry) => entry.fragment);
    const mode =
      fragments.every((f) => f !== "" && f !== "#") && new Set(fragments).size === group.length
        ? "fragment"
        : "salt";
    const guidCount = new Map<string, number>();
    for (const entry of group) {
      const guid = entry.raw.guid?.trim() ?? "";
      guidCount.set(guid, (guidCount.get(guid) ?? 0) + 1);
    }
    for (const entry of group) {
      const guid = entry.raw.guid?.trim() ?? "";
      modes.set(entry.raw, { mode, useTitle: !guid || (guidCount.get(guid) ?? 0) > 1 });
    }
  }
  return modes;
}

/** Build every entry, keeping order and dropping the ones that do not qualify. */
export function buildItems(raws: readonly RawItem[], context: BuildContext): Item[] {
  const shared = sharedUrlModes(raws, context);
  const items: Item[] = [];
  for (const raw of raws) {
    const item = buildItem(raw, context, shared.get(raw));
    if (item) items.push(item);
  }
  return items;
}
