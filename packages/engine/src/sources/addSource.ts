import type { Source } from "@dispatch/core";
import { channelFeedUrl } from "../fetch/youtube.js";
import { slugify } from "../normalize/slugify.js";
import { type DiscoverDeps, discoverFeed, resolveYoutubeChannel } from "./discover.js";
import { urlKey } from "./import.js";

export class AddSourceError extends Error {
  /**
   * The address itself is the answer (a duplicate, a dead page, a social site): asking again cannot
   * change it. False only where a failed lookup could be the cause, so the site may ask again (D149).
   */
  readonly definite: boolean;
  constructor(message: string, options: { definite?: boolean } = {}) {
    super(message);
    this.name = "AddSourceError";
    this.definite = options.definite ?? true;
  }
}

export interface AddSourceInput {
  url: string;
  origin: "manual" | "auto";
  topicIds?: readonly string[] | undefined;
  /** An id the caller chose (already checked free); otherwise one is made from the address. */
  id?: string | undefined;
  /** Display name; defaults to the host. */
  name?: string | undefined;
  /** Ids already in use, so the new id never collides with a seed or earlier added source. */
  takenIds: ReadonlySet<string>;
  /** Registry entries to compare against, so the same page or feed is not added twice. */
  existing: readonly Pick<Source, "id" | "url" | "feed_url">[];
}

const LEADING_WWW = /^www\./;
/** Sites Firecrawl does not scrape. YouTube and GitHub are read through their own feeds. */
const SOCIAL_HOSTS =
  /(^|\.)(x\.com|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|threads\.net|threads\.com)$/;

/** Readable host: no scheme, no "www.". */
export function hostLabel(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(LEADING_WWW, "");
}

/** A unique id from the host (and first path segment, which tells section feeds apart). */
export function sourceIdFor(url: string, taken: ReadonlySet<string>): string {
  const parsed = new URL(url);
  const segment = parsed.pathname.split("/").filter(Boolean)[0];
  const base = slugify(
    `${hostLabel(url)}${segment && segment.length <= 24 ? `-${segment}` : ""}`,
    48,
  );
  const root = base === "" ? "source" : base;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function duplicateOf(
  existing: AddSourceInput["existing"],
  ...urls: (string | null)[]
): string | undefined {
  const keys = new Set(urls.filter((u): u is string => u !== null).map(urlKey));
  return existing.find(
    (source) =>
      keys.has(urlKey(source.url)) || (source.feed_url && keys.has(urlKey(source.feed_url))),
  )?.id;
}

/**
 * Turn a URL into a source. GitHub repositories and YouTube channels become their own types; any
 * other page is searched for a feed (an rss source), and a page with none becomes a scrape source
 * that Firecrawl reads. A page that is gone, or a host that does not exist, is an error rather
 * than a source that would fail every run.
 */
export async function buildSourceFromUrl(
  input: AddSourceInput,
  deps: DiscoverDeps,
): Promise<Source> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new AddSourceError(`"${input.url}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AddSourceError("Only http and https URLs can be sources.");
  }
  const host = hostLabel(input.url);
  const common = {
    tier: "daily" as const,
    high_signal: false,
    enabled: true,
    failures: 0,
    origin: input.origin,
    ...(input.topicIds && input.topicIds.length > 0 ? { topic_ids: [...input.topicIds] } : {}),
  };

  if (host === "github.com") {
    const repo = /^\/([^/]+\/[^/]+?)(?:\/.*)?$/.exec(parsed.pathname)?.[1];
    if (!repo)
      throw new AddSourceError(
        "A GitHub source needs a repository URL such as github.com/owner/name.",
      );
    const feed = `https://github.com/${repo}/releases.atom`;
    const dup = duplicateOf(input.existing, `https://github.com/${repo}/releases`, feed);
    if (dup) throw new AddSourceError(`Already a source: ${dup}.`);
    return {
      ...common,
      id: input.id ?? sourceIdFor(`https://github.com/${repo}`, input.takenIds),
      name: input.name ?? repo,
      type: "github",
      url: `https://github.com/${repo}/releases`,
      feed_url: feed,
      options: { repo },
    };
  }

  if (host.endsWith("youtube.com")) {
    const channelId = await resolveYoutubeChannel(input.url, deps).catch(() => undefined);
    if (!channelId)
      throw new AddSourceError(
        "Could not find a YouTube channel there. Give a channel address such as youtube.com/@name.",
        // YouTube's resolver may simply not have answered.
        { definite: false },
      );
    const feed = channelFeedUrl(channelId);
    const dup = duplicateOf(input.existing, input.url, feed);
    if (dup) throw new AddSourceError(`Already a source: ${dup}.`);
    return {
      ...common,
      id: input.id ?? sourceIdFor(input.url, input.takenIds),
      name: input.name ?? `${host} channel`,
      type: "youtube",
      url: input.url,
      feed_url: feed,
      options: { channel_id: channelId },
    };
  }

  // A page or feed already followed is refused before any request is made.
  const known = duplicateOf(input.existing, input.url);
  if (known) throw new AddSourceError(`Already a source: ${known}.`);
  const found = await discoverFeed(input.url, deps);
  if (found.status === "dead") {
    throw new AddSourceError(`That page is not reachable (${found.reason}).`);
  }
  const feedUrl = found.status === "feed" ? found.feedUrl : null;
  // A scrape source is read with Firecrawl, which cannot read social media: refuse it here rather
  // than add a source that fails every run. A social page with a feed (Reddit) is still a feed.
  if (!feedUrl && SOCIAL_HOSTS.test(host)) {
    throw new AddSourceError(
      "Social media pages cannot be read. Add the site's own feed or home page instead.",
    );
  }
  const dup = duplicateOf(input.existing, input.url, feedUrl);
  if (dup) throw new AddSourceError(`Already a source: ${dup}.`);
  return {
    ...common,
    id: input.id ?? sourceIdFor(input.url, input.takenIds),
    name: input.name ?? host,
    type: feedUrl ? "rss" : "firecrawl",
    url: input.url,
    feed_url: feedUrl,
    options: found.status === "feed" && found.linkKind ? { kind: found.linkKind } : {},
  };
}
