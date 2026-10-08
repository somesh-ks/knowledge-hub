import {
  CATEGORIES,
  type Category,
  type Item,
  type JudgmentEntry,
  seedTopicsFile,
  type Topic,
  VOICE_LIMITS,
} from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { clamp01, round4 } from "../src/score/numbers.js";
import { craftFactor, penaltyFactor, scoreItem } from "../src/score/scoreItem.js";
import {
  applyTopics,
  FIT_EXPONENT,
  fitCurve,
  scoreWithTopics,
  type TopicLayer,
  topicScore,
} from "../src/score/scoreTopics.js";
import {
  assignSections,
  eligibility,
  selectItems,
  TECH_ALLOWANCE,
  takeOwnSections,
} from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";
import { makeEntry, makeItem, plainPreferences } from "./score-factories.js";
import { loadTopicsFromSeed } from "./topics-helpers.js";

const preferences = plainPreferences();

function customTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: "quantum_computing",
    name: "Quantum computing",
    description: "Hardware, algorithms and error correction.",
    weight: 0.8,
    enabled: true,
    keywords: ["qubit"],
    section_id: "quantum",
    never_publish: false,
    origin: "custom",
    depth: "fit_only",
    ...overrides,
  };
}

function layerOf(topics: Topic[], fits: TopicLayer["fits"]): TopicLayer {
  return { topics, fits };
}

describe("a pool of every category", () => {
  /** A deterministic spread of items: every category, several depths, flags and launch scales. */
  function fixturePool(): { item: Item; entry: JudgmentEntry }[] {
    const pool: { item: Item; entry: JudgmentEntry }[] = [];
    let n = 0;
    for (const category of [...CATEGORIES, "none" as const]) {
      for (const depth of [0, 0.5, 1]) {
        for (const hype of [0, 0.8]) {
          n += 1;
          const item = makeItem({
            title: `Pool item ${n} about ${category}`,
            published_at: `2026-10-0${1 + (n % 6)}T08:00:00Z`,
            ...(n % 7 === 0 ? { source_type: "youtube" as const } : {}),
          });
          pool.push({
            item,
            entry: makeEntry(item, {
              category,
              p: 0.55 + (n % 5) * 0.1,
              depth,
              launchScale: (n % 5) / 4,
              hype,
              sponsored: n % 4 === 0 ? 0.5 : 0,
              funding: n % 9 === 0 ? 0.7 : 0,
            }),
          });
        }
      }
    }
    return pool;
  }

  // Built once: every call to makeItem mints new ids, and both runs must see the same items.
  const POOL = fixturePool();

  function run(layer: TopicLayer | undefined, kind: "regular" | "weekly") {
    const scored = POOL.map(({ item, entry }) =>
      layer === undefined
        ? scoreItem(entry, preferences, item)
        : scoreWithTopics(entry, preferences, item, layer),
    );
    return {
      scored,
      selection: selectItems({
        scored,
        kind,
        floor: VOICE_LIMITS.items.floor,
        cap: VOICE_LIMITS.items.cap,
        weights: preferences.weights,
      }),
    };
  }

  it.each(["regular", "weekly"] as const)(
    "scores and selects the same %s digest with and without the topics layer",
    (kind) => {
      const without = run(undefined, kind);
      expect(without.selection.selected.length).toBeGreaterThan(5);

      // The seeded file has only built-in topics, so the layer holds no custom topic at all.
      const seeded = loadTopicsFromSeed(preferences);
      const noCustom = run(layerOf(seeded.custom, {}), kind);
      expect(noCustom).toEqual(without);

      // A custom topic that was judged for nothing changes nothing either.
      const unjudged = run(layerOf([customTopic()], {}), kind);
      expect(unjudged).toEqual(without);

      // Nor does one whose weight is zero, however well the judge thought items fit it.
      const fits = Object.fromEntries(POOL.map(({ item }) => [item.id, { quantum_computing: 1 }]));
      const silenced = run(layerOf([customTopic({ weight: 0 })], fits), kind);
      expect(silenced).toEqual(without);
    },
  );

  it("returns the very same scored object when no custom topic wins", () => {
    const [first] = POOL;
    const base = scoreItem(first?.entry as JudgmentEntry, preferences, first?.item as Item);
    expect(applyTopics(base, undefined)).toBe(base);
    expect(applyTopics(base, layerOf([], {}))).toBe(base);
    expect(applyTopics(base, layerOf([customTopic()], {}))).toBe(base);
  });
});

describe("a custom topic's score", () => {
  const item = makeItem({ title: "A qubit milestone" });
  const none = makeEntry(item, { category: "none", p: 1 });

  it("is weight x fit^1.5 x the penalty factor", () => {
    const topic = customTopic({ weight: 0.8 });
    const hyped = makeEntry(item, { category: "none", hype: 0.5, sponsored: 0.5 });
    const result = topicScore(topic, 0.75, hyped);
    expect(FIT_EXPONENT).toBe(1.5);
    expect(result?.score).toBe(round4(0.8 * 0.75 ** 1.5 * penaltyFactor(hyped.flags)));
    expect(topicScore(topic, undefined, hyped)).toBeNull();
  });

  it("asks for a clear fit: loosely tied stays under the bar, clearly about it clears it", () => {
    const topic = customTopic({ weight: 0.7 });
    expect(topicScore(topic, 0.5, none)?.score).toBeLessThan(0.4);
    expect(topicScore(topic, 0.75, none)?.score).toBeGreaterThan(0.4);
    expect(fitCurve(0)).toBe(0);
    expect(fitCurve(1)).toBe(1);
  });

  it("multiplies in the craft factor for a craft topic and leaves a fit-only topic alone", () => {
    const shallow = makeEntry(item, { category: "none", depth: 0 });
    const plain = topicScore(customTopic({ depth: "fit_only" }), 1, shallow);
    const craft = topicScore(customTopic({ depth: "craft" }), 1, shallow);
    expect(plain?.score).toBe(0.8);
    expect(craft?.score).toBe(round4(clamp01(0.8 * craftFactor(0))));
  });

  it("beats the built-in score only when it is higher, and then names the topic and section", () => {
    const weak = makeEntry(item, { category: "design_engineering_craft", p: 0.6, depth: 0.2 });
    const builtin = scoreItem(weak, preferences, item);
    const layer = layerOf([customTopic()], { [item.id]: { quantum_computing: 1 } });
    const won = applyTopics(builtin, layer);
    expect(won.score).toBeGreaterThan(builtin.score);
    expect(won.topic).toEqual({
      id: "quantum_computing",
      section_id: "quantum",
      never_publish: false,
      fit: 1,
    });
    // The built-in category the judge found is kept, for the writer's label.
    expect(won.topCategory).toBe("design_engineering_craft");

    const strong = scoreItem(
      makeEntry(item, { category: "design_engineering_craft" }),
      preferences,
      item,
    );
    const lost = applyTopics(strong, layerOf([customTopic({ weight: 0.5 })], layer.fits));
    expect(lost).toBe(strong);
  });

  it("picks the best of several topics", () => {
    const layer = layerOf(
      [
        customTopic({ id: "a_topic", weight: 0.5, section_id: "sec_a" }),
        customTopic({ id: "b_topic", weight: 0.9, section_id: "sec_b" }),
      ],
      { [item.id]: { a_topic: 1, b_topic: 1 } },
    );
    expect(applyTopics(scoreItem(none, preferences, item), layer).topic?.id).toBe("b_topic");
  });
});

describe("selection with custom topics", () => {
  let seq = 100;
  function scoredFor(
    topic: Topic | null,
    score: number,
    category: Category | "none" = "none",
    overrides: Partial<Item> = {},
  ): ScoredItem {
    seq += 1;
    const item = makeItem({ id: seq.toString(16).padStart(12, "0"), ...overrides });
    return {
      item,
      entry: makeEntry(item, { category }),
      score,
      topCategory: category,
      breakdown: { taste: score, craftFactor: 1, penaltyFactor: 1, bonus: 0 },
      ...(topic
        ? {
            topic: {
              id: topic.id,
              section_id: topic.section_id,
              never_publish: topic.never_publish,
              fit: 1,
            },
          }
        : {}),
    };
  }

  it("files a topic's story under the topic's section with the topic as category", () => {
    const verdict = eligibility(scoredFor(customTopic(), 0.7));
    expect(verdict).toMatchObject({
      eligible: true,
      candidate: { category: "quantum_computing", home: "quantum" },
    });
  });

  it("sends a topic's video to watch, as for every other category", () => {
    const verdict = eligibility(scoredFor(customTopic(), 0.7, "none", { source_type: "youtube" }));
    expect(verdict).toMatchObject({ eligible: true, candidate: { home: "watch" } });
  });

  it("drops a never-publish topic and anything below the bar", () => {
    expect(eligibility(scoredFor(customTopic({ never_publish: true }), 0.9))).toEqual({
      eligible: false,
      reason: "never_publish",
    });
    expect(eligibility(scoredFor(customTopic(), 0.1))).toEqual({
      eligible: false,
      reason: "below_threshold",
    });
  });

  it("gives a custom section up to five stories of its own, outside the main cap", () => {
    const quantum = customTopic();
    const main = Array.from({ length: 14 }, (_, n) =>
      scoredFor(null, 0.9 - n * 0.01, "design_engineering_craft"),
    );
    const own = Array.from({ length: 7 }, (_, n) => scoredFor(quantum, 0.95 - n * 0.01));
    const result = selectItems({ scored: [...main, ...own], kind: "regular", floor: 3, cap: 12 });
    const chosenOwn = result.selected.filter((s) => s.home === "quantum");
    expect(chosenOwn).toHaveLength(TECH_ALLOWANCE);
    expect(result.selected.filter((s) => s.home !== "quantum")).toHaveLength(12);
    expect(result.dropped.filter((d) => d.reason === "over_section_cap")).toHaveLength(2);
    // The best two of the seven are not the dropped ones.
    const dropped = new Set(result.dropped.map((d) => d.id));
    expect(chosenOwn.every((s) => !dropped.has(s.item.id))).toBe(true);
  });

  it("keeps a custom section's stories out of Top picks, however high they score", () => {
    const quantum = customTopic();
    const result = selectItems({
      scored: [
        scoredFor(quantum, 0.99),
        scoredFor(null, 0.8, "design_engineering_craft"),
        scoredFor(null, 0.7, "hci_empirical_research"),
        scoredFor(null, 0.6, "frontier_model_releases"),
      ],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    const top = result.selected.filter((s) => s.section === "top");
    expect(top).toHaveLength(3);
    expect(top.some((s) => s.home === "quantum")).toBe(false);
  });

  it("treats Tech and each custom section as separate pools of five", () => {
    const quantum = customTopic();
    const biotech = customTopic({ id: "biotech", name: "Biotech", section_id: "biotech" });
    const tech = Array.from({ length: 6 }, (_, n) =>
      scoredFor(null, 0.8 - n * 0.01, "consumer_tech_releases"),
    );
    const q = Array.from({ length: 6 }, (_, n) => scoredFor(quantum, 0.7 - n * 0.01));
    const b = Array.from({ length: 6 }, (_, n) => scoredFor(biotech, 0.65 - n * 0.01));
    const main = Array.from({ length: 3 }, (_, n) =>
      scoredFor(null, 0.9 - n * 0.01, "design_engineering_craft"),
    );
    const result = selectItems({
      scored: [...tech, ...q, ...b, ...main],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    const count = (home: string) => result.selected.filter((s) => s.home === home).length;
    expect(count("tech")).toBe(5);
    expect(count("quantum")).toBe(5);
    expect(count("biotech")).toBe(5);
    expect(result.dropped.filter((d) => d.reason === "over_tech_cap")).toHaveLength(1);
    expect(result.dropped.filter((d) => d.reason === "over_section_cap")).toHaveLength(2);
  });

  it("never takes more than the hard maximum of the digest", () => {
    const candidates = Array.from({ length: 40 }, (_, n) => ({
      item: makeItem(),
      category: "x",
      home: `sec-${n % 8}`,
      score: 0.9 - n * 0.001,
    }));
    const { chosen, over } = takeOwnSections(candidates, 10);
    expect(chosen).toHaveLength(10);
    expect(over).toHaveLength(30);
  });

  it("orders custom sections after the built-in ones, by their best story", () => {
    const candidates = [
      { item: makeItem(), category: "b", home: "beta", score: 0.6 },
      { item: makeItem(), category: "a", home: "alpha", score: 0.7 },
      { item: makeItem(), category: "design_engineering_craft", home: "watch", score: 0.5 },
      { item: makeItem(), category: "x", home: "ui-craft", score: 0.9 },
      { item: makeItem(), category: "y", home: "ui-craft", score: 0.85 },
      { item: makeItem(), category: "z", home: "ui-craft", score: 0.8 },
      { item: makeItem(), category: "w", home: "ui-craft", score: 0.4 },
    ];
    const order = [...new Set(assignSections(candidates).map((s) => s.section))];
    expect(order).toEqual(["top", "ui-craft", "watch", "alpha", "beta"]);
  });
});

describe("the seed file", () => {
  it("has no custom topic, so the layer is empty", () => {
    const seed = seedTopicsFile(preferences.weights);
    expect(seed.topics.every((topic) => topic.origin === "builtin")).toBe(true);
  });
});
