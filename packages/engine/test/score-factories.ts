import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORIES,
  type Category,
  type CategoryOrNone,
  Item,
  itemId,
  JudgmentEntry,
  Preferences,
} from "@dispatch/core";

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root, found from this file so tests never depend on the working directory. */
export const REPO_ROOT = join(here, "..", "..", "..");
/** Frozen copies of the owner-editable config files; see fixtures/config/README.md. */
export const FIXTURE_CONFIG = join(here, "fixtures", "config");

let counter = 0;

export function makeItem(overrides: Partial<Item> = {}): Item {
  counter += 1;
  // One host per item, so the outlet cap (OUTLET_CAP, by host) never decides a test about something else.
  const url = overrides.url ?? `https://outlet-${counter}.example/post-${counter}`;
  return Item.parse({
    id: itemId(url),
    url,
    canonical_url: url,
    title: `Post ${counter}`,
    // One source per item, so the outlet cap (OUTLET_CAP) never decides a test about something else.
    source_id: `example-blog-${counter}`,
    source_type: "rss",
    fetched_at: "2026-10-05T05:00:00Z",
    snippet: "",
    ...overrides,
  });
}

export interface EntryOptions {
  category?: CategoryOrNone;
  /** Probability on `category`; the rest goes to "none". */
  p?: number;
  depth?: number;
  /** Normalized launch scale. Left out of the entry when not given, as in older cache entries. */
  launchScale?: number;
  hype?: number;
  sponsored?: number;
  funding?: number;
  model?: string;
  judgedAt?: string;
}

export function makeEntry(itemOrId: Item | string, options: EntryOptions = {}): JudgmentEntry {
  const category = options.category ?? "design_engineering_craft";
  const p = options.p ?? 1;
  const probs = Object.fromEntries([...CATEGORIES, "none"].map((c) => [c, 0])) as Record<
    CategoryOrNone,
    number
  >;
  probs[category] = p;
  if (category !== "none") probs.none = 1 - p;
  return JudgmentEntry.parse({
    item_id: typeof itemOrId === "string" ? itemOrId : itemOrId.id,
    model: options.model ?? "jev-test",
    questions_hash: "abc123def456",
    judged_at: options.judgedAt ?? "2026-10-05T06:00:00Z",
    category_probs: probs,
    craft_depth: options.depth ?? 1,
    ...(options.launchScale === undefined ? {} : { launch_scale: options.launchScale }),
    flags: {
      hype: options.hype ?? 0,
      sponsored: options.sponsored ?? 0,
      funding: options.funding ?? 0,
    },
  });
}

/** The real config/preferences.json. */
export function realPreferences(): Preferences {
  const text = readFileSync(join(FIXTURE_CONFIG, "preferences.json"), "utf8");
  return Preferences.parse(JSON.parse(text));
}

/** A copy of the real preferences with no keywords or authors, so bonuses never interfere. */
export function plainPreferences(): Preferences {
  return { ...realPreferences(), preferred_authors: [], preferred_keywords: [] };
}

export function weightsOf(preferences: Preferences): Record<Category, number> {
  return preferences.weights;
}
