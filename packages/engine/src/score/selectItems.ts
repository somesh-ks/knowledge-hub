import {
  CATEGORIES,
  type Category,
  type DigestKind,
  hasOwnAllowance,
  homeSection,
  type Item,
  isBuiltinCategory,
  isBuiltinSection,
  isGeneralTopicId,
  SECTIONS,
  snapWeight,
  TECH_SECTION,
  VOICE_LIMITS,
} from "@dispatch/core";
import {
  isPatchRelease,
  isReleaseNote,
  isReleaseStory,
  RELEASE_NOTE_SHARE,
  RELEASE_SECTION,
} from "./releaseNotes.js";
import { sameStoryRepeats } from "./sameStory.js";
import type { Candidate, ScoredItem, SelectedItem } from "./types.js";

/**
 * Minimum score to publish. A starting value: it is tuned on the golden set (see eval/), and
 * lives in code, never in a prompt. An off-taste item with no craft cannot reach it, while a
 * frontier-model announcement (weight 0.85, depth 0) lands just above it.
 */
export const DEFAULT_SCORE_THRESHOLD = 0.4;

/** Items taken per home section before overflow is allowed. Does not apply to Tech releases. */
export const SECTION_TARGET_MAX = 3;

/** Top picks: the highest-scoring items outside Tech releases, moved out of their home section. */
export const TOP_PICKS = 3;

export type DropReason =
  | "no_category"
  | "never_publish"
  | "below_threshold"
  | "over_cap"
  /** A Tech releases candidate beyond that section's own allowance. */
  | "over_tech_cap"
  /** A candidate beyond the allowance of a custom section, or beyond the digest's hard maximum. */
  | "over_section_cap"
  /** A candidate whose section the scheduled briefing does not cover (config/schedule.json). */
  | "skipped_topic"
  /** An older GitHub release of a repository that has a newer release among the candidates. */
  | "same_repo_release"
  /** A patch release, or a release note beyond the briefing's share of them (releaseNotes.ts). */
  | "release_note"
  /** The same story as a better-ranked candidate, from another angle or another day (sameStory.ts). */
  | "same_story";

export interface DroppedItem {
  id: string;
  reason: DropReason;
  score: number;
}

export interface SelectInput {
  scored: readonly ScoredItem[];
  kind: DigestKind;
  /** Fewer qualifying items than this returns the "nothing" outcome. */
  floor: number;
  /**
   * Requested cap for everything outside Tech releases; never raised above the hard cap for the
   * kind (12, weekly 18) unless `total` sizes the briefing, when the owner's length decides.
   * Tech releases has its own allowance on top of it.
   */
  cap: number;
  /**
   * Stories in every section together, Tech releases and the other allowances included: the
   * briefing's length in stories. Absent means the digest's hard cap.
   */
  total?: number;
  /**
   * Preference weights. Only the weekly kind needs them, to find the category median for the
   * reserved off-taste slot. Without them no slot is reserved.
   */
  weights?: Record<Category, number>;
  threshold?: number;
  /**
   * Topic ids this briefing leaves out, from config/schedule.json: a story whose winning topic is
   * one of them is dropped before anything is picked, so it reaches Top picks neither.
   */
  skipTopics?: readonly string[];
  /** Regenerate: keep only these categories, on top of skipTopics. Absent keeps every category. */
  onlyTopics?: readonly string[];
}

export interface SelectResult {
  outcome: "selected" | "nothing";
  /** In digest order: top picks first, then sections in SECTIONS order, each by score. */
  selected: SelectedItem[];
  dropped: DroppedItem[];
  /** Items that cleared the threshold before the cap and section targets applied. */
  qualifying: number;
}

/** Hard cap on items outside Tech releases, for a digest kind. */
export function capFor(kind: DigestKind): number {
  return kind === "weekly" ? VOICE_LIMITS.items.weeklyCap : VOICE_LIMITS.items.cap;
}

/**
 * Items each section with an allowance of its own may hold, in addition to `capFor`. The same for
 * every kind and every such section: Tech releases and each section a custom topic defines.
 */
export const TECH_ALLOWANCE = VOICE_LIMITS.items.techCap;

/**
 * Items a general news section may hold, on top of `capFor` like every section with an allowance
 * of its own. Smaller than the tech allowance because up to five of these sections can play in
 * one briefing: at most ten stories, the same for the daily and the weekly kind.
 */
export const GENERAL_ALLOWANCE = 2;

/** Items one section with an allowance of its own may hold. */
export function allowanceFor(section: string): number {
  return isGeneralTopicId(section) ? GENERAL_ALLOWANCE : TECH_ALLOWANCE;
}

/** True for a candidate that belongs in the Tech releases section. A tech video belongs in "watch". */
export function isTech(candidate: Pick<Candidate, "home">): boolean {
  return candidate.home === TECH_SECTION;
}

/**
 * True for a candidate whose section takes its stories from an allowance of its own, outside the
 * main cap: Tech releases, or a section a custom topic defined. Such stories never move to Top
 * picks, because Top picks is for the best of the main sections.
 */
export function hasOwnSection(candidate: Pick<Candidate, "home">): boolean {
  return hasOwnAllowance(candidate.home);
}

/**
 * Median of the eleven preference weights: the middle one. The even branch is for the day a
 * twelfth category arrives, when it becomes the mean of the middle two.
 */
export function medianWeight(weights: Record<Category, number>): number {
  const sorted = CATEGORIES.map((c) => weights[c]).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[Math.floor(mid)] as number);
}

function publishedMs(item: Item): number {
  if (!item.published_at) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(item.published_at);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Total order for ranking: higher score, then newer, then lower id. The id step makes ties
 * deterministic whatever order the pool arrived in.
 */
export function compareCandidates(
  a: { item: Item; score: number },
  b: { item: Item; score: number },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const pa = publishedMs(a.item);
  const pb = publishedMs(b.item);
  if (pa !== pb) return pb > pa ? 1 : -1;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

/**
 * Final sections for a chosen set: the three highest scores outside Tech releases become "top",
 * the rest keep their home section. A tech story never moves to Top picks, however high it scores,
 * so with fewer than three other items there are fewer than three picks. Also used after later
 * stages drop items, so top picks always stay the best three that remain.
 */
export function assignSections(chosen: readonly Candidate[]): SelectedItem[] {
  const ranked = [...chosen].sort(compareCandidates);
  let picks = 0;
  const withSection: SelectedItem[] = ranked.map((candidate) => {
    // Library, framework and changelog news is never a Top pick and closes the episode.
    if (!hasOwnSection(candidate) && isReleaseStory(candidate)) {
      return { ...candidate, section: RELEASE_SECTION };
    }
    const pick = !hasOwnSection(candidate) && picks < TOP_PICKS;
    if (pick) picks += 1;
    return { ...candidate, section: pick ? "top" : candidate.home };
  });
  // Built-in sections keep their fixed order. A custom section follows them, in order of its best
  // story, so the digest reads the same whatever order the topics were added in.
  const best = new Map<string, number>();
  withSection.forEach((entry, index) => {
    if (!best.has(entry.section)) best.set(entry.section, index);
  });
  const order = (section: string): number =>
    section === RELEASE_SECTION
      ? Number.MAX_SAFE_INTEGER
      : isBuiltinSection(section)
        ? SECTIONS.indexOf(section)
        : SECTIONS.length + (best.get(section) ?? 0);
  return withSection.sort((a, b) => {
    if (a.section !== b.section) return order(a.section) - order(b.section);
    return compareCandidates(a, b);
  });
}

/**
 * The stories of sections with an allowance of their own: up to `allowanceFor` per section, taken
 * in rank order, and never more than `room` in all so the digest stays under its hard maximum.
 * Each section is its own pool, so none borrows from or lends to the main cap or another section.
 */
export function takeOwnSections(
  own: readonly Candidate[],
  room: number,
): { chosen: Candidate[]; over: Candidate[] } {
  const perSection = new Map<string, number>();
  const chosen: Candidate[] = [];
  // Each section's best story first, so a short briefing still hears every one of them.
  const firsts = own.filter(
    (candidate, i) => own.findIndex((other) => other.home === candidate.home) === i,
  );
  for (const candidate of [...firsts, ...own.filter((c) => !firsts.includes(c))]) {
    const count = perSection.get(candidate.home) ?? 0;
    if (count < allowanceFor(candidate.home) && chosen.length < room) {
      chosen.push(candidate);
      perSection.set(candidate.home, count + 1);
    }
  }
  return { chosen, over: own.filter((candidate) => !chosen.includes(candidate)) };
}

/**
 * The repository a GitHub release belongs to, as "owner/repo" from a github.com URL, else the
 * source id (one GitHub source follows one repository). Null for anything that is not a release.
 */
export function releaseRepo(
  item: Pick<Item, "source_type" | "canonical_url" | "source_id">,
): string | null {
  if (item.source_type !== "github") return null;
  try {
    const url = new URL(item.canonical_url);
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (url.hostname.replace(/^www\./, "") === "github.com" && owner && repo) {
      return `${owner}/${repo}`.toLowerCase();
    }
  } catch {
    // Fall through to the source id.
  }
  return `source:${item.source_id}`;
}

/**
 * One release per repository: a monorepo can ship v1.2.3 and v1.2.4 in the same window, and a
 * briefing never lists two releases of the same project. The newest wins (then the usual rank
 * order); the rest are returned as `older`.
 */
export function newestReleasePerRepo(candidates: readonly Candidate[]): {
  kept: Candidate[];
  older: Candidate[];
} {
  const newest = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const repo = releaseRepo(candidate.item);
    if (repo === null) continue;
    const current = newest.get(repo);
    if (!current) {
      newest.set(repo, candidate);
      continue;
    }
    const a = publishedMs(candidate.item);
    const b = publishedMs(current.item);
    if (a > b || (a === b && compareCandidates(candidate, current) < 0)) {
      newest.set(repo, candidate);
    }
  }
  const kept: Candidate[] = [];
  const older: Candidate[] = [];
  for (const candidate of candidates) {
    const repo = releaseRepo(candidate.item);
    if (repo === null || newest.get(repo) === candidate) kept.push(candidate);
    else older.push(candidate);
  }
  return { kept, older };
}

export type Eligibility =
  | { eligible: true; candidate: Candidate }
  | { eligible: false; reason: DropReason };

/** Whether a scored item may publish at all, before the cap and section targets apply. */
export function eligibility(
  scored: ScoredItem,
  threshold: number = DEFAULT_SCORE_THRESHOLD,
  weights?: Readonly<Partial<Record<Category, number>>>,
): Eligibility {
  if (scored.topic) {
    // A custom topic won: it names the category, the section and whether the story may publish.
    const { topic } = scored;
    if (topic.never_publish) return { eligible: false, reason: "never_publish" };
    if (scored.score < threshold) return { eligible: false, reason: "below_threshold" };
    const home = topic.section_id;
    return {
      eligible: true,
      candidate: { item: scored.item, category: topic.id, home, score: scored.score },
    };
  }
  const category = scored.topCategory;
  if (category === "none") return { eligible: false, reason: "no_category" };
  if (weights !== undefined && snapWeight(weights[category] ?? 1) === 0) {
    return { eligible: false, reason: "never_publish" };
  }
  if (weights !== undefined && snapWeight(weights[category] ?? 1) === 0)
    return { eligible: false, reason: "never_publish" };
  const home = homeSection(category, scored.item.source_type);
  if (home === null) return { eligible: false, reason: "never_publish" };
  if (scored.score < threshold) return { eligible: false, reason: "below_threshold" };
  return { eligible: true, candidate: { item: scored.item, category, home, score: scored.score } };
}

/**
 * Pick what to publish. Order of rules:
 *  1. Drop items whose most probable option is "none" or a never-publish category.
 *  2. Drop items below the score threshold, every GitHub release but the newest of its
 *     repository, and every story but the best told of one subject (sameStory.ts).
 *  3. Split what is left into two pools: Tech releases candidates, and everything else.
 *  4. Everything else: patch releases never air, and release notes take at most a tenth of the
 *     cap (at least one). Within that, take the best item of each category first, then walk by rank taking at
 *     most 3 per home section up to the cap, then let overflow fill any remaining room, so a thin
 *     section never leaves slots empty.
 *  5. Weekly only: guarantee one of those slots for the best item whose category weight is below
 *     the median of preferences, so taste does not narrow week over week.
 *  6. Sections with an allowance of their own (Tech releases, and each section a custom topic
 *     defines, and each general news section): take the best of each by rank up to its allowance
 *     (5, or 2 for a general section), on top of the cap. The per-section target does not apply,
 *     and these pools never borrow from or lend to the cap.
 *  7. Fewer than `floor` chosen across both pools means nothing publishes.
 *  8. Assign sections: the three highest scores outside those sections become Top picks.
 */
export function selectItems(input: SelectInput): SelectResult {
  const threshold = input.threshold ?? DEFAULT_SCORE_THRESHOLD;
  // A briefing sized by the owner's length selects its spares too, so its total may pass the
  // digest's hard maximum; validation airs at most that many.
  const total = input.total ?? VOICE_LIMITS.items.hardMax;
  const dropped: DroppedItem[] = [];
  const candidates: Candidate[] = [];

  for (const scored of input.scored) {
    const verdict = eligibility(scored, threshold, input.weights);
    if (verdict.eligible) {
      if (
        input.skipTopics?.includes(verdict.candidate.category) ||
        (input.onlyTopics && !input.onlyTopics.includes(verdict.candidate.category))
      ) {
        dropped.push({ id: scored.item.id, reason: "skipped_topic", score: scored.score });
      } else {
        candidates.push(verdict.candidate);
      }
    } else dropped.push({ id: scored.item.id, reason: verdict.reason, score: scored.score });
  }

  const releases = newestReleasePerRepo(candidates);
  for (const candidate of releases.older) {
    dropped.push({ id: candidate.item.id, reason: "same_repo_release", score: candidate.score });
  }
  // A release note never stands for a story told elsewhere: "llm-mistral 0.16 adds Mistral Large 4
  // support" gives way to the launch itself.
  const repeats = sameStoryRepeats(
    releases.kept
      .sort(compareCandidates)
      .sort((a, b) => Number(isReleaseNote(a.item)) - Number(isReleaseNote(b.item)))
      .map((c) => c.item),
  );
  const ranked: Candidate[] = [];
  for (const candidate of releases.kept) {
    if (repeats.has(candidate.item.id)) {
      dropped.push({ id: candidate.item.id, reason: "same_story", score: candidate.score });
    } else ranked.push(candidate);
  }
  ranked.sort(compareCandidates);
  const main: Candidate[] = [];
  for (const candidate of ranked) {
    if (hasOwnSection(candidate)) continue;
    if (isReleaseNote(candidate.item) && isPatchRelease(candidate.item)) {
      dropped.push({ id: candidate.item.id, reason: "release_note", score: candidate.score });
    } else main.push(candidate);
  }
  const own = ranked.filter(hasOwnSection);
  // The main sections leave room for one story from each section with an allowance of its own.
  const ownSections = new Set(own.map((candidate) => candidate.home)).size;
  // A briefing sized by the owner's length is held to that length, not to the kind's count cap.
  const kindCap = input.total === undefined ? capFor(input.kind) : total;
  const limit = Math.min(input.cap, kindCap, Math.max(0, total - ownSections));

  const chosen = new Set<Candidate>();
  const perSection = new Map<string, number>();
  const releaseRoom = Math.max(1, Math.floor(limit * RELEASE_NOTE_SHARE));
  const releasesIn = (): number => [...chosen].filter(isReleaseStory).length;
  const fits = (candidate: Candidate): boolean =>
    !isReleaseStory(candidate) || releasesIn() < releaseRoom;
  const take = (candidate: Candidate): void => {
    chosen.add(candidate);
    perSection.set(candidate.home, (perSection.get(candidate.home) ?? 0) + 1);
  };
  // Every topic with a story that cleared the bar gets its best one first, so a strong section
  // cannot crowd a selected topic out of the briefing.
  const covered = new Set<string>();
  for (const candidate of main) {
    if (chosen.size >= limit) break;
    if (covered.has(candidate.category) || !fits(candidate)) continue;
    covered.add(candidate.category);
    take(candidate);
  }
  for (const candidate of main) {
    if (chosen.size >= limit) break;
    if (chosen.has(candidate) || !fits(candidate)) continue;
    if ((perSection.get(candidate.home) ?? 0) < SECTION_TARGET_MAX) take(candidate);
  }
  for (const candidate of main) {
    if (chosen.size >= limit) break;
    if (!chosen.has(candidate) && fits(candidate)) take(candidate);
  }

  // The reserved slot is one of the capped slots, so it is filled from the same pool. Tech
  // releases has an allowance of its own and never needs it.
  if (input.kind === "weekly" && input.weights && limit > 0) {
    const median = medianWeight(input.weights);
    // A custom topic has no preference weight, so it never fills the off-taste slot.
    const reserve = main.find(
      (c) =>
        input.weights !== undefined &&
        (chosen.has(c) || fits(c)) &&
        isBuiltinCategory(c.category) &&
        input.weights[c.category] < median,
    );
    if (reserve && !chosen.has(reserve)) {
      if (chosen.size >= limit) {
        const lowest = [...chosen].sort(compareCandidates).pop();
        if (lowest) chosen.delete(lowest);
      }
      chosen.add(reserve);
    }
  }

  const ownTaken = takeOwnSections(own, total - chosen.size);
  const chosenTech = ownTaken.chosen;
  if (chosen.size + chosenTech.length < input.floor) {
    return { outcome: "nothing", selected: [], dropped, qualifying: ranked.length };
  }

  for (const candidate of main) {
    if (!chosen.has(candidate)) {
      const reason = isReleaseStory(candidate) && !fits(candidate) ? "release_note" : "over_cap";
      dropped.push({ id: candidate.item.id, reason, score: candidate.score });
    }
  }
  for (const candidate of ownTaken.over) {
    dropped.push({
      id: candidate.item.id,
      reason: isTech(candidate) ? "over_tech_cap" : "over_section_cap",
      score: candidate.score,
    });
  }
  return {
    outcome: "selected",
    selected: assignSections([...chosen, ...chosenTech]),
    dropped,
    qualifying: ranked.length,
  };
}
