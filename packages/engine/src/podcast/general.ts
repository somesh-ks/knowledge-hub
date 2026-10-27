import { generalTopicTitle, type Item, type Source } from "@singularity/core";
import type { Logger } from "../context.js";
import { clusterStories } from "../dedupe/storyCluster.js";
import { entryToRaw, loadFeed } from "../fetch/feedItems.js";
import type { HttpClient } from "../http.js";
import { buildItems } from "../normalize/buildItem.js";
import {
  createFileProfileStore,
  dropBlocked,
  isBlockedSource,
  OWNER_ID,
} from "../profile/profile.js";
import { voteMultiplier, votePreferences } from "../profile/votes.js";
import { outletOf } from "../run/generalNews.js";
import { loadSources } from "../sources/registry.js";
import type { PodcastPlan } from "./plan.js";
import { joinNames } from "./select.js";
import { PodcastError, type PodcastStory } from "./types.js";

const DAY_MS = 86_400_000;

/** A general episode needs at least this many stories (fewer when the length cannot carry more). */
export const MIN_GENERAL_STORIES = 3;

/** Most top stories an episode opens with, and the share of its stories they may take. */
const MAX_TOP_STORIES = 4;
const TOP_SHARE = 0.25;

export interface GeneralSelection {
  stories: PodcastStory[];
  /** Stories found in the chosen topics' feeds, after clustering and before the length trimmed them. */
  matched: number;
  feeds_ok: number;
  feeds_failed: number;
  /** Chosen topics whose feeds held no story in the window. The episode is built from the others. */
  empty_topics: string[];
}

export interface GeneralDeps {
  root: string;
  plan: PodcastPlan;
  now: Date;
  http: HttpClient;
  log?: Logger | undefined;
  /**
   * The sources to read, for tests. Defaults to the registry the app edits: config/sources.json
   * with config/sources.user.json laid over it. A source the owner switched off is not read, and
   * one the owner added to a general topic is.
   */
  sources?: readonly Source[] | undefined;
  /** The fewest stories that make a selection. Defaults to MIN_GENERAL_STORIES (fewer when the length is short). */
  minStories?: number | undefined;
  /** Coverage leaders that open the episode before the topics are dealt; defaults to `topStoryCount`. */
  leaders?: number | undefined;
}

/** A story as it came out of clustering: the kept item, who covered it and under which topics. */
interface Candidate {
  item: Item;
  topics: Set<string>;
  outlets: Set<string>;
  coverage: number;
}

/**
 * The source an item is built from. Its id is the outlet, so two feeds of one outlet (NPR's world
 * and business desks) are one outlet when the stories are counted, and its topics are left to the
 * caller: a story takes the topic it was read for.
 */
function outletSource(source: Source, feedUrl: string): Source {
  const { topic_ids: _topics, ...rest } = source;
  return { ...rest, id: outletOf(source), type: "rss", feed_url: feedUrl };
}

/**
 * The sources a general topic is read from: enabled, with a feed to read, and tagged with the
 * topic. A general topic is always on, so only a source can be switched off.
 */
export function sourcesForTopic(
  sources: readonly Source[],
  topicId: string,
): Array<Source & { feed_url: string }> {
  return sources.flatMap((source) =>
    source.enabled && source.type === "rss" && source.feed_url !== null
      ? source.topic_ids?.includes(topicId)
        ? [{ ...source, feed_url: source.feed_url }]
        : []
      : [],
  );
}

function timeOf(item: Item): number {
  const ms = Date.parse(item.published_at ?? item.fetched_at);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Coverage first (outlets that carried the story), then the newest, then id so the order is total. */
export function byCoverageThenRecency(a: Candidate, b: Candidate): number {
  return (
    b.coverage - a.coverage || timeOf(b.item) - timeOf(a.item) || a.item.id.localeCompare(b.item.id)
  );
}

/** How many top stories open an episode that has room for `max` stories. */
export function topStoryCount(max: number): number {
  return Math.max(1, Math.min(MAX_TOP_STORIES, Math.round(max * TOP_SHARE)));
}

/**
 * Choose the stories: the highest-coverage stories across all chosen topics open the episode, then
 * the topics follow in the order chosen, each with its best remaining stories. Slots are dealt out
 * round-robin so one busy topic cannot crowd out the rest. Pure, so a test can pin the order.
 */
export function pickStories(
  candidates: readonly Candidate[],
  topicIds: readonly string[],
  max: number,
  /** The owner's vote multiplier for a story, applied to its coverage; 1 when absent. */
  lean: (candidate: Candidate) => number = () => 1,
  /**
   * Stories that open ahead of the topic round-robin: the coverage leaders of every topic together.
   * A mixed episode takes none (the briefing topics hold its opening, and each general topic gets its
   * own slot): the 2026-10-27 Catch up spent two of its three general slots on the day's most
   * syndicated stories, which were celebrity news.
   */
  leaders = topStoryCount(max),
): Candidate[] {
  const ranked = [...candidates].sort(
    (a, b) => b.coverage * lean(b) - a.coverage * lean(a) || byCoverageThenRecency(a, b),
  );
  const top = ranked.slice(0, Math.min(leaders, ranked.length));
  const taken = new Set(top.map((c) => c.item.id));

  // Each story belongs to the first chosen topic that carried it.
  const home = (c: Candidate): string =>
    topicIds.find((id) => c.topics.has(id)) ?? topicIds[0] ?? "";
  const queues = new Map<string, Candidate[]>(topicIds.map((id) => [id, []]));
  for (const c of ranked) if (!taken.has(c.item.id)) queues.get(home(c))?.push(c);

  const chosen = new Map<string, Candidate[]>(topicIds.map((id) => [id, []]));
  let room = max - top.length;
  while (room > 0) {
    let dealt = false;
    for (const id of topicIds) {
      const next = queues.get(id)?.shift();
      if (!next || room === 0) continue;
      chosen.get(id)?.push(next);
      room -= 1;
      dealt = true;
    }
    if (!dealt) break;
  }
  return [...top, ...topicIds.flatMap((id) => chosen.get(id) ?? [])];
}

function toStory(c: Candidate, topicIds: readonly string[]): PodcastStory {
  const topic = topicIds.find((id) => c.topics.has(id)) ?? topicIds[0] ?? "";
  return {
    item_id: c.item.id,
    headline: c.item.title,
    // The feed's description is the only text there is; a title alone is a valid story.
    summary: c.item.snippet || c.item.title,
    source: [...c.outlets].slice(0, 3).join(", "),
    url: c.item.url,
    section: topic,
    category: topic,
  };
}

/**
 * Pick the stories of a general episode from the open category feeds of the chosen topics. No
 * briefing, no model and no paid service: feeds are read, clustered across outlets with the news
 * profile and ranked by how many outlets carried each story.
 */
export async function selectGeneralStories(deps: GeneralDeps): Promise<GeneralSelection> {
  const { plan, now, http, log } = deps;
  const { request } = plan;
  const topicIds = request.topic_ids;
  const profile = await createFileProfileStore(deps.root).read(OWNER_ID);
  const blocked = profile.blocked_domains;
  const votePrefs = votePreferences(profile.votes, now);
  const sources = (deps.sources ?? (await loadSources(deps.root)).sources).filter(
    (source) => !isBlockedSource(source, blocked),
  );
  const window = { from: new Date(now.getTime() - request.window_days * DAY_MS), to: now };

  const jobs = topicIds.flatMap((topic) =>
    sourcesForTopic(sources, topic).map((source) => ({ topic, source })),
  );
  if (jobs.length === 0) {
    throw new PodcastError(
      `No news source is switched on for ${joinNames(topicIds.map(generalTopicTitle))}; turn one on in Topics and sources.`,
    );
  }
  const settled = await Promise.allSettled(
    jobs.map(async ({ topic, source }) => {
      const parsed = await loadFeed(source.feed_url, { http, now: () => now });
      const items = buildItems(parsed.entries.map(entryToRaw), {
        source: outletSource(source, source.feed_url),
        window,
        fetchedAt: now,
      });
      return { topic, source, items };
    }),
  );

  let feedsOk = 0;
  let feedsFailed = 0;
  let blockedCount = 0;
  const byId = new Map<string, { item: Item; topics: Set<string>; outlet: string }>();
  const topicHasItems = new Set<string>();
  for (const [index, result] of settled.entries()) {
    const job = jobs[index];
    if (result.status === "rejected" || !job) {
      feedsFailed += 1;
      log?.warn("A news feed could not be read", {
        feed: job?.source.feed_url,
        reason: result.status === "rejected" ? String(result.reason).split("\n")[0] : "unknown",
      });
      continue;
    }
    feedsOk += 1;
    // An outlet's feed can carry links to another domain; those are dropped too.
    const { kept, dropped } = dropBlocked(result.value.items, blocked, (item) => item.url);
    blockedCount += dropped;
    for (const item of kept) {
      topicHasItems.add(job.topic);
      const known = byId.get(item.id);
      if (known) known.topics.add(job.topic);
      else byId.set(item.id, { item, topics: new Set([job.topic]), outlet: job.source.name });
    }
  }
  if (blockedCount > 0)
    log?.info("Dropped stories from blocked domains", { blocked: blockedCount });
  if (feedsOk === 0) {
    throw new PodcastError(
      `No news feed could be read for ${joinNames(topicIds.map(generalTopicTitle))}; try again in a few minutes.`,
    );
  }
  const emptyTopics = topicIds.filter((id) => !topicHasItems.has(id));
  if (emptyTopics.length > 0) {
    log?.warn("Some chosen topics have no stories in the window", { topics: emptyTopics });
  }

  // Cluster across outlets and topics. The kept item stands in for its cluster; its outlets and
  // topics are gathered as the others are absorbed.
  const outlets = new Map<string, Set<string>>();
  const topics = new Map<string, Set<string>>();
  for (const [id, entry] of byId) {
    outlets.set(id, new Set([entry.outlet]));
    topics.set(id, entry.topics);
  }
  const clustered = clusterStories({
    profile: "news",
    items: [...byId.values()].map((entry) => entry.item),
    eligible: () => true,
    // The fuller description leads, then the newest; id makes the order total.
    compare: (a, b) =>
      b.snippet.length - a.snippet.length || timeOf(b) - timeOf(a) || a.id.localeCompare(b.id),
    absorb: (keep, dropped) => {
      for (const name of outlets.get(dropped.id) ?? []) outlets.get(keep.id)?.add(name);
      for (const topic of topics.get(dropped.id) ?? []) topics.get(keep.id)?.add(topic);
      return keep;
    },
  });
  const candidates: Candidate[] = clustered.items.map((item) => ({
    item,
    topics: topics.get(item.id) ?? new Set<string>(),
    outlets: outlets.get(item.id) ?? new Set<string>(),
    coverage: item.signals.coverage ?? 1,
  }));

  const needed = deps.minStories ?? Math.min(MIN_GENERAL_STORIES, Math.max(2, plan.max_stories));
  if (candidates.length < needed) {
    throw new PodcastError(
      `Only ${candidates.length} ${candidates.length === 1 ? "story" : "stories"} in the news feeds for ${joinNames(topicIds.map(generalTopicTitle))}; an episode needs at least ${needed}. Try more topics.`,
    );
  }
  const picked = pickStories(
    candidates,
    topicIds,
    Math.max(2, plan.max_stories),
    (c) => voteMultiplier(votePrefs, c.item.source_id, c.item.url),
    deps.leaders,
  );
  return {
    stories: picked.map((c) => toStory(c, topicIds)),
    matched: candidates.length,
    feeds_ok: feedsOk,
    feeds_failed: feedsFailed,
    empty_topics: emptyTopics,
  };
}
