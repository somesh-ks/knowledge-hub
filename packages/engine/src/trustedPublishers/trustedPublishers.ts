import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Category, type Item, type Topic } from "@singularity/core";
import { z } from "zod";
import { EXPERIMENT_IDS, experimentOverride } from "../experiments/overrides.js";
import type { ExaQuery } from "../fetch/queries.js";
import { clamp01, round4 } from "../score/numbers.js";
import { craftFactor, penaltyFactor } from "../score/scoreItem.js";
import type { ScoredItem } from "../score/types.js";

export const TRUSTED_PUBLISHERS_PATH = "config/trusted-publishers.json";

/**
 * One publisher the owner vetted as the first-hand source for some categories. `domain` is a host
 * ("openai.com" covers "www.openai.com" and "platform.openai.com"). A first-party announcement
 * describes no technique, so the depth score sinks it (anthropic-blog: 0 of 15 passed, D234);
 * the owner's vetting is the signal the judge lacks.
 */
export const TrustedPublisherEntry = z.object({
  domain: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/),
  categories: z.array(Category).min(1),
  /** Why the owner trusts it; read by people only. */
  note: z.string().optional(),
});
export type TrustedPublisherEntry = z.infer<typeof TrustedPublisherEntry>;

export const TrustedPublishersFile = z.object({
  version: z.literal(1),
  /** Off until the owner signs the list off: nothing below changes a score, a pool or a query. */
  enabled: z.boolean(),
  entries: z.array(TrustedPublisherEntry),
});
export type TrustedPublishersFile = z.infer<typeof TrustedPublishersFile>;

export const EMPTY_TRUSTED_PUBLISHERS: TrustedPublishersFile = {
  version: 1,
  enabled: false,
  entries: [],
};

export function parseTrustedPublishers(json: unknown): TrustedPublishersFile {
  return TrustedPublishersFile.parse(json);
}

/** Missing file means no trusted publishers list, not an error. */
export async function loadTrustedPublishers(root: string): Promise<TrustedPublishersFile> {
  const file = await readTrustedPublishers(root);
  // The owner's switch in the admin app wins over the file (experiments/overrides.ts).
  const enabled = await experimentOverride(root, EXPERIMENT_IDS.trustedPublishers);
  return enabled === undefined ? file : { ...file, enabled };
}

async function readTrustedPublishers(root: string): Promise<TrustedPublishersFile> {
  let text: string;
  try {
    text = await readFile(join(root, TRUSTED_PUBLISHERS_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_TRUSTED_PUBLISHERS;
    throw error;
  }
  return parseTrustedPublishers(JSON.parse(text) as unknown);
}

/**
 * The craft depth a trusted publisher's announcement is read at when the judge found less (0.25 is "names
 * a feature but does not explain it"). Taste 0.7 x craft factor 0.747 = 0.52: over the 0.4 bar,
 * under a real walkthrough (0.7 at depth 1), so the owner's list lets an announcement air without
 * letting it outrank technique.
 */
export const TRUSTED_PUBLISHERS_DEPTH = 0.25;

/** The categories an item's host is vetted for; empty when it is not on the list. */
export type TrustedPublisherMatcher = (item: Pick<Item, "url">) => readonly Category[];

const NO_CATEGORIES: readonly Category[] = [];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A matcher that finds nothing: the list is off, or there is none. */
export const NO_TRUSTED_PUBLISHERS: TrustedPublisherMatcher = () => NO_CATEGORIES;

export function trustedPublisherMatcher(
  file: TrustedPublishersFile | undefined,
): TrustedPublisherMatcher {
  if (!file?.enabled || file.entries.length === 0) return NO_TRUSTED_PUBLISHERS;
  return (item) => {
    const host = hostOf(item.url);
    if (host === null) return NO_CATEGORIES;
    const found = new Set<Category>();
    for (const entry of file.entries) {
      if (host === entry.domain || host.endsWith(`.${entry.domain}`)) {
        for (const category of entry.categories) found.add(category);
      }
    }
    return found.size === 0 ? NO_CATEGORIES : [...found];
  };
}

/**
 * The list read as if on, while it is off and holds entries: the write stage logs what it would
 * add, so the owner signs the list off against real runs (D234). Finds nothing otherwise.
 */
export function trustedPublisherShadowMatcher(
  file: TrustedPublishersFile | undefined,
): TrustedPublisherMatcher {
  if (!file || file.enabled) return NO_TRUSTED_PUBLISHERS;
  return trustedPublisherMatcher({ ...file, enabled: true });
}

/**
 * Whether an item's host is on the list for any category. The prefilter reads it as it reads a
 * high-signal source: an announcement names none of the owner's keywords and would be dropped.
 */
export function isTrustedPublisher(
  matcher: TrustedPublisherMatcher | undefined,
  item: Pick<Item, "url">,
) {
  return matcher !== undefined && matcher(item).length > 0;
}

/**
 * Lift a built-in score for a vetted publisher. Only when the item's most probable category is
 * one the owner vetted that domain for: the same publisher's customer stories or job posts
 * (category "none" or another) keep their score. Two terms change, nothing else: craft depth
 * is read as at least TRUSTED_PUBLISHERS_DEPTH, and the hype and sponsored flags no longer count, since a
 * publisher's own announcement is promotional by nature and that is what the list accepts. The
 * funding flag still does. The score never goes down. A custom topic that won keeps its score.
 */
export function withTrustedPublishers(
  scored: ScoredItem,
  matcher: TrustedPublisherMatcher | undefined,
): ScoredItem {
  if (!matcher || scored.topic) return scored;
  const category = scored.topCategory;
  if (category === "none" || !matcher(scored.item).includes(category)) return scored;
  const depth = Math.max(scored.breakdown.craftFactor, craftFactor(TRUSTED_PUBLISHERS_DEPTH));
  const penalty = penaltyFactor({ ...scored.entry.flags, hype: 0, sponsored: 0 });
  const score = round4(clamp01(scored.breakdown.taste * depth * penalty + scored.breakdown.bonus));
  if (score <= scored.score) return scored;
  return {
    ...scored,
    score,
    breakdown: {
      ...scored.breakdown,
      craftFactor: round4(depth),
      penaltyFactor: round4(penalty),
      trusted_publisher: true,
    },
  };
}

/**
 * One Exa query for each vetted category, restricted to the vetted domains: open discovery found
 * small or SEO-looking domains (6 of 11), so these ask only the publishers the owner trusts.
 * The query text is the topic's own name and description, which the owner can reword. A category
 * whose topic is gone or switched off asks nothing.
 */
export function trustedPublisherQueries(
  file: TrustedPublishersFile | undefined,
  topics: readonly Pick<Topic, "id" | "name" | "description" | "enabled">[],
): ExaQuery[] {
  if (!file?.enabled) return [];
  const queries: ExaQuery[] = [];
  const categories = new Set(file.entries.flatMap((entry) => entry.categories));
  for (const category of categories) {
    const topic = topics.find((t) => t.id === category);
    if (!topic?.enabled) continue;
    const domains = file.entries
      .filter((entry) => entry.categories.includes(category))
      .map((entry) => entry.domain);
    queries.push({
      id: `trusted-publisher-${category.replaceAll("_", "-")}`,
      query: `${topic.name}: ${topic.description}`,
      include_domains: domains,
      category_hint: category,
    });
  }
  return queries;
}
