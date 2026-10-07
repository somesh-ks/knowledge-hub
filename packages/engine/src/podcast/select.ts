import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Digest, parseDigestFile, stockholmDate } from "@dispatch/core";
import type { Logger } from "../context.js";
import type { PodcastPlan } from "./plan.js";
import { PodcastError, type PodcastStory } from "./types.js";

const DAY_MS = 86_400_000;
const DIGEST_FILE = /^\d{4}-\d{2}-\d{2}.*\.md$/;

export interface Selection {
  stories: PodcastStory[];
  /** Stories that matched the topics and window, before the budget trimmed them. */
  matched: number;
  digests: number;
}

/** One story per URL: the same link in two digests is the same story. */
function urlKey(url: string): string {
  return url.trim().replace(/#.*$/, "").replace(/\/+$/, "");
}

async function digestPaths(root: string, cutoffDate: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(join(root, "Digests"), { recursive: true });
  } catch {
    return [];
  }
  // The file name starts with the digest's Stockholm date, so old files are skipped unread. A day of
  // slack covers a digest generated just after midnight on the cutoff date.
  return names
    .filter((name) => DIGEST_FILE.test(basename(name)) && basename(name).slice(0, 10) >= cutoffDate)
    .map((name) => join(root, "Digests", name));
}

async function loadDigests(root: string, from: Date, now: Date, log?: Logger): Promise<Digest[]> {
  const cutoff = stockholmDate(new Date(from.getTime() - DAY_MS));
  const digests: Digest[] = [];
  for (const path of await digestPaths(root, cutoff)) {
    try {
      const digest = parseDigestFile(await readFile(path, "utf8"));
      const at = Date.parse(digest.generated_at);
      if (at >= from.getTime() && at <= now.getTime()) digests.push(digest);
    } catch (error) {
      log?.warn("Skipped a digest that could not be read", {
        path: basename(path),
        reason: error instanceof Error ? error.message.split("\n")[0] : "unknown",
      });
    }
  }
  return digests;
}

/**
 * Pick the stories for an episode from published digests, with no fetching and no judging. A story
 * matches when its section or its category is one of the requested topics. Newest digest first,
 * best score first inside a digest, one story per URL, trimmed to what the budget can carry.
 */
export async function selectStories(
  root: string,
  plan: PodcastPlan,
  now: Date,
  log?: Logger,
): Promise<Selection> {
  const { request } = plan;
  const from = new Date(now.getTime() - request.window_days * DAY_MS);
  const digests = (await loadDigests(root, from, now, log)).sort((a, b) =>
    b.generated_at.localeCompare(a.generated_at),
  );
  const topics = new Set(request.topic_ids);
  const seen = new Set<string>();
  const matched: PodcastStory[] = [];
  for (const digest of digests) {
    const items = [...digest.items].sort((a, b) => b.score - a.score);
    for (const item of items) {
      if (!topics.has(item.section) && !topics.has(item.category)) continue;
      const key = urlKey(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push({
        item_id: item.id,
        headline: item.headline,
        summary: item.summary,
        source: item.source,
        url: item.url,
        section: item.section,
        category: item.category,
      });
    }
  }
  if (matched.length < 2) {
    const advice =
      request.window_days < 30 ? "Try a longer window or more topics." : "Try more topics.";
    throw new PodcastError(
      `Only ${matched.length} ${matched.length === 1 ? "story matches" : "stories match"} ${request.topic_ids.join(", ")} in the last ${request.window_days} days; an episode needs at least 2. ${advice}`,
    );
  }
  return {
    stories: matched.slice(0, Math.max(2, plan.max_stories)),
    matched: matched.length,
    digests: digests.length,
  };
}
