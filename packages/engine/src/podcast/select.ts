import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Digest, parseDigestFile, stockholmDate } from "@dispatch/core";
import type { Logger } from "../context.js";
import { createFileProfileStore, isBlockedUrl, OWNER_ID } from "../profile/profile.js";
import { voteMultiplier, votePreferences } from "../profile/votes.js";
import { RELEASE_CATEGORY, RELEASE_SECTION } from "../score/releaseNotes.js";
import { topicLabel } from "./episode.js";
import type { PodcastPlan } from "./plan.js";
import { PodcastError, type PodcastStory } from "./types.js";

const DAY_MS = 86_400_000;
const DIGEST_FILE = /^\d{4}-\d{2}-\d{2}.*\.md$/;

export interface Selection {
  stories: PodcastStory[];
  /** Stories that matched the topics and window, before the budget trimmed them. */
  matched: number;
  digests: number;
  /** Chosen topics with no story in the window. The episode is built from the others. */
  empty_topics: string[];
}

/** "Design", "Design and AI Products", "Design, AI Products and Trending". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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

/** The section id of Top picks. It is never a choice: every episode carries the window's top picks. */
export const TOP_SECTION = "top";

/**
 * Whether a story belongs in an episode. A story matches when its section or its category is one
 * of the requested topics, and a Top pick always matches (D39): it is the best of any topic in the
 * window, whatever the listener chose.
 */
export function matchesRequest(
  item: { section: string; category: string },
  topicIds: ReadonlySet<string>,
): boolean {
  return item.section === TOP_SECTION || topicIds.has(item.section) || topicIds.has(item.category);
}

/**
 * Pick the stories for an episode from published digests, with no fetching and no judging. See
 * `matchesRequest` for what matches. Newest digest first, best score first inside a digest, one
 * story per URL, trimmed to what the budget can carry.
 */
export async function selectStories(
  root: string,
  plan: PodcastPlan,
  now: Date,
  log?: Logger,
  /** The fewest stories that make a selection; 2 for an episode of briefing topics alone. */
  minStories = 2,
): Promise<Selection> {
  const { request } = plan;
  const from = new Date(now.getTime() - request.window_days * DAY_MS);
  const digests = (await loadDigests(root, from, now, log)).sort((a, b) =>
    b.generated_at.localeCompare(a.generated_at),
  );
  const topics = new Set(request.topic_ids);
  const seen = new Set<string>();
  const matched: PodcastStory[] = [];
  // Topics that at least one story in the window belongs to; Top picks alone never fill a topic.
  const covered = new Set<string>();
  // A story from a domain the owner blocked after the digest was written stays out of the episode.
  const profile = await createFileProfileStore(root).read(OWNER_ID);
  const blocked = profile.blocked_domains;
  // Digest items carry the outlet's name, not its id, so the owner's votes weigh by domain here.
  const votePrefs = votePreferences(profile.votes, now);
  const weight = (item: { score: number; url: string }): number =>
    item.score * voteMultiplier(votePrefs, "", item.url);
  let blockedCount = 0;
  for (const digest of digests) {
    const items = [...digest.items].sort((a, b) => weight(b) - weight(a));
    for (const item of items) {
      if (!matchesRequest(item, topics)) continue;
      if (isBlockedUrl(item.url, blocked)) {
        blockedCount += 1;
        continue;
      }
      for (const id of [item.section, item.category]) if (topics.has(id)) covered.add(id);
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
  if (blockedCount > 0)
    log?.info("Dropped stories from blocked domains", { blocked: blockedCount });
  // Never fall back to the window's top picks alone: the listener asked for these topics.
  const emptyTopics = request.topic_ids.filter((id) => !covered.has(id));
  if (emptyTopics.length === request.topic_ids.length) {
    throw new PodcastError(
      `No stories in ${joinNames(emptyTopics.map(topicLabel))} in the last ${request.window_days} days.`,
    );
  }
  if (emptyTopics.length > 0) {
    log?.warn("Some chosen topics have no stories in the window", { topics: emptyTopics });
  }
  if (matched.length < minStories) {
    const advice =
      request.window_days < 30 ? "Try a longer window or more topics." : "Try more topics.";
    throw new PodcastError(
      `Only ${matched.length} ${matched.length === 1 ? "story matches" : "stories match"} ${request.topic_ids.join(", ")} in the last ${request.window_days} days; an episode needs at least ${minStories}. ${advice}`,
    );
  }
  // Library, framework and changelog news goes last, so it closes an episode and is the first cut
  // when the budget is short (2026-10-18).
  const ordered = [
    ...matched.filter((story) => !filedAsRelease(story)),
    ...matched.filter(filedAsRelease),
  ];
  return {
    stories: ordered.slice(0, Math.max(2, plan.max_stories)),
    matched: matched.length,
    digests: digests.length,
    empty_topics: emptyTopics,
  };
}

/**
 * A published story a briefing filed as release news, by its section or its category. Its title is
 * gone by now, so this reads what the digest kept (selection uses releaseNotes.isReleaseStory).
 */
function filedAsRelease(story: { section: string; category: string }): boolean {
  return story.section === RELEASE_SECTION || story.category === RELEASE_CATEGORY;
}
