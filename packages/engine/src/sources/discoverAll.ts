import type { Source, SourcesFile } from "@dispatch/core";
import { createLimiter } from "../fetch/limiter.js";
import { channelFeedUrl } from "../fetch/youtube.js";
import { type DiscoverDeps, discoverFeed, resolveYoutubeChannel } from "./discover.js";

export interface DiscoverReportEntry {
  id: string;
  outcome: "feed" | "scrape" | "dead" | "blocked" | "youtube" | "unresolved" | "kept";
  feed_url?: string;
  detail?: string;
  requests: number;
}

export interface DiscoverAllOptions {
  /** Re-check sources that already have a verified feed. */
  all?: boolean;
  only?: readonly string[];
  concurrency?: number;
}

/** Types that are pages or feeds; API sources never need discovery. */
const PAGE_TYPES = new Set<Source["type"]>(["rss", "firecrawl"]);

function withoutHint(options: Record<string, string>): Record<string, string> {
  const { feed_hint: _hint, ...rest } = options;
  return rest;
}

async function discoverOne(
  source: Source,
  deps: DiscoverDeps,
  all: boolean,
): Promise<{ source: Source; entry: DiscoverReportEntry }> {
  if (source.type === "youtube") {
    const handle = source.options.handle;
    if (source.options.channel_id || !handle) {
      return { source, entry: { id: source.id, outcome: "kept", requests: 0 } };
    }
    try {
      const channelId = await resolveYoutubeChannel(`https://www.youtube.com/@${handle}`, deps);
      if (!channelId) throw new Error("no channel id found on the page");
      const { note: _note, ...rest } = source.options;
      return {
        source: {
          ...source,
          enabled: true,
          feed_url: channelFeedUrl(channelId),
          options: { ...rest, channel_id: channelId },
        },
        entry: {
          id: source.id,
          outcome: "youtube",
          feed_url: channelFeedUrl(channelId),
          requests: 1,
        },
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        source: {
          ...source,
          enabled: false,
          options: { ...source.options, note: `channel id not resolved: ${detail}`.slice(0, 160) },
        },
        entry: { id: source.id, outcome: "unresolved", detail, requests: 1 },
      };
    }
  }

  const needsWork = PAGE_TYPES.has(source.type) && (all || source.feed_url === null);
  const manuallyDisabled = !source.enabled && source.options.note !== undefined;
  if (!needsWork || manuallyDisabled) {
    return { source, entry: { id: source.id, outcome: "kept", requests: 0 } };
  }

  const result = await discoverFeed(source.url, deps, source.options.feed_hint);
  const options = withoutHint(source.options);
  // A re-check must not throw away a known feed because the page is down or stopped advertising it.
  if (source.feed_url !== null && result.status !== "feed") {
    return {
      source: { ...source, options },
      entry: {
        id: source.id,
        outcome: "kept",
        detail: `re-check: ${result.status}`,
        requests: result.requests,
      },
    };
  }
  switch (result.status) {
    case "feed":
      return {
        source: {
          ...source,
          type: "rss",
          feed_url: result.feedUrl,
          options: {
            ...options,
            ...(result.linkKind && !options.kind ? { kind: result.linkKind } : {}),
          },
        },
        entry: {
          id: source.id,
          outcome: "feed",
          feed_url: result.feedUrl,
          detail: result.via,
          requests: result.requests,
        },
      };
    case "none":
      return {
        source: { ...source, type: "firecrawl", feed_url: null, options },
        entry: { id: source.id, outcome: "scrape", requests: result.requests },
      };
    case "blocked":
      return {
        source: {
          ...source,
          type: "firecrawl",
          feed_url: null,
          options: {
            ...options,
            note: `blocked for plain requests (${result.reason}); needs Firecrawl`,
          },
        },
        entry: {
          id: source.id,
          outcome: "blocked",
          detail: result.reason,
          requests: result.requests,
        },
      };
    case "dead":
      return {
        source: {
          ...source,
          enabled: false,
          type: "firecrawl",
          feed_url: null,
          options: { ...options, note: `dead link: ${result.reason}` },
        },
        entry: { id: source.id, outcome: "dead", detail: result.reason, requests: result.requests },
      };
    default: {
      const unreachable: never = result;
      throw new Error(`unhandled discovery result ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Run feed discovery over a registry. Returns the updated registry and one report entry per
 * source; failures of one source never stop the pass. Order of sources is preserved.
 */
export async function discoverAll(
  file: SourcesFile,
  deps: DiscoverDeps,
  options: DiscoverAllOptions = {},
): Promise<{ file: SourcesFile; report: DiscoverReportEntry[] }> {
  const limiter = createLimiter(options.concurrency ?? 4);
  const outcomes = await Promise.all(
    file.sources.map((source) => {
      if (options.only && !options.only.includes(source.id)) {
        return Promise.resolve({
          source,
          entry: { id: source.id, outcome: "kept", requests: 0 } satisfies DiscoverReportEntry,
        });
      }
      return limiter.run(async () => {
        try {
          return await discoverOne(source, deps, options.all ?? false);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return {
            source,
            entry: {
              id: source.id,
              outcome: "kept",
              detail,
              requests: 0,
            } satisfies DiscoverReportEntry,
          };
        }
      });
    }),
  );
  return {
    file: { ...file, sources: outcomes.map((o) => o.source) },
    report: outcomes.map((o) => o.entry),
  };
}
