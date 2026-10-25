import { type Category, type Item, SECTIONS, VOICE_LIMITS } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { scoreItem } from "../src/score/scoreItem.js";
import {
  assignSections,
  capFor,
  compareCandidates,
  DEFAULT_SCORE_THRESHOLD,
  isTech,
  medianWeight,
  newestReleasePerRepo,
  releaseRepo,
  SECTION_TARGET_MAX,
  selectItems,
  TECH_ALLOWANCE,
  TOP_PICKS,
} from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";
import { makeEntry, makeItem, plainPreferences, realPreferences } from "./score-factories.js";

const weights = realPreferences().weights;

let seq = 0;
/** A pre-scored item with an exact score, so selection rules are tested apart from scoring. */
function scored(
  category: Category | "none",
  score: number,
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
  };
}

const ids = (items: { item: Item }[]): string[] => items.map((s) => s.item.id);

describe("sections from the schedule", () => {
  const pool = (): ScoredItem[] => [
    scored("design_engineering_craft", 0.9),
    scored("frontier_model_releases", 0.85),
    scored("hci_empirical_research", 0.8),
    scored("consumer_tech_releases", 0.75),
  ];
  const homeOf = (result: ReturnType<typeof selectItems>, id: string) =>
    result.selected.find((s) => s.item.id === id)?.home;

  it("covers every topic when none is left out", () => {
    const items = pool();
    for (const skipTopics of [undefined, []]) {
      const result = selectItems({ scored: items, kind: "regular", floor: 1, cap: 12, skipTopics });
      expect(result.selected).toHaveLength(4);
    }
  });

  it("drops the stories of a topic left out and records why", () => {
    const items = pool();
    const result = selectItems({
      scored: items,
      kind: "regular",
      floor: 1,
      cap: 12,
      skipTopics: ["design_engineering_craft", "hci_empirical_research", "consumer_tech_releases"],
    });
    expect(result.selected.map((s) => s.item.id)).toEqual([items[1]?.item.id]);
    expect(homeOf(result, items[1]?.item.id as string)).toBe("ai");
    expect(result.dropped.filter((d) => d.reason === "skipped_topic")).toHaveLength(3);
  });

  it("keeps only the chosen topics when a regeneration names them", () => {
    const items = pool();
    const result = selectItems({
      scored: items,
      kind: "regular",
      floor: 1,
      cap: 12,
      onlyTopics: ["design_engineering_craft"],
    });
    expect(result.selected.map((s) => s.item.id)).toEqual([items[0]?.item.id]);
  });

  it("keeps a topic left out away from Top picks too", () => {
    const items = pool();
    const result = selectItems({
      scored: items,
      kind: "regular",
      floor: 1,
      cap: 12,
      skipTopics: ["design_engineering_craft"],
    });
    expect(result.selected.map((s) => s.item.id)).not.toContain(items[0]?.item.id);
  });

  it("returns nothing when what is left has too few stories", () => {
    const result = selectItems({
      scored: pool(),
      kind: "regular",
      floor: 3,
      cap: 12,
      skipTopics: ["design_engineering_craft", "frontier_model_releases", "hci_empirical_research"],
    });
    expect(result.outcome).toBe("nothing");
  });

  // The owner sets how far back a podcast looks on its settings page; a story older than that
  // would air as news after the owner said it was too old to.
  it("leaves out a story older than the podcast's lookback, dated by its fetch when it has no date", () => {
    const now = new Date("2026-10-24T06:00:00Z");
    const fresh = scored("design_engineering_craft", 0.9, { published_at: "2026-10-23T12:00:00Z" });
    const old = scored("frontier_model_releases", 0.85, { published_at: "2026-10-21T06:00:00Z" });
    const undated = scored("hci_empirical_research", 0.8, {
      published_at: undefined,
      fetched_at: "2026-10-20T06:00:00Z",
    });
    const items = [fresh, old, undated];
    const limited = selectItems({
      scored: items,
      kind: "regular",
      floor: 1,
      cap: 12,
      lookbackHours: 24,
      now,
    });
    expect(ids(limited.selected)).toEqual([fresh.item.id]);
    expect(
      limited.dropped
        .filter((d) => d.reason === "too_old")
        .map((d) => d.id)
        .sort(),
    ).toEqual([old.item.id, undated.item.id].sort());
    const auto = selectItems({
      scored: items,
      kind: "regular",
      floor: 1,
      cap: 12,
      lookbackHours: null,
      now,
    });
    expect(auto.selected).toHaveLength(3);
  });
});

describe("eligibility", () => {
  it("drops items below the threshold and records why", () => {
    const low = scored("design_engineering_craft", DEFAULT_SCORE_THRESHOLD - 0.01);
    const result = selectItems({
      scored: [
        scored("design_engineering_craft", 0.9),
        scored("hci_empirical_research", 0.8),
        scored("css_canvas_motion_techniques", 0.7),
        low,
      ],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    expect(result.outcome).toBe("selected");
    expect(result.dropped).toContainEqual({
      id: low.item.id,
      reason: "below_threshold",
      score: low.score,
    });
  });

  it("keeps an item exactly at the threshold", () => {
    const edge = scored("design_engineering_craft", DEFAULT_SCORE_THRESHOLD);
    const result = selectItems({
      scored: [
        scored("design_engineering_craft", 0.9),
        scored("hci_empirical_research", 0.8),
        edge,
      ],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    expect(ids(result.selected)).toContain(edge.item.id);
  });

  it("never publishes a category at Off (weight 0), whatever its score", () => {
    const vc = scored("venture_capital_and_gossip", 0.99);
    const hype = scored("generic_ai_hype_listicles", 0.98);
    const result = selectItems({
      scored: [
        vc,
        hype,
        scored("design_engineering_craft", 0.9),
        scored("hci_empirical_research", 0.8),
        scored("css_canvas_motion_techniques", 0.7),
      ],
      kind: "regular",
      weights,
      floor: 3,
      cap: 12,
    });
    expect(ids(result.selected)).not.toContain(vc.item.id);
    expect(ids(result.selected)).not.toContain(hype.item.id);
    expect(result.dropped.filter((d) => d.reason === "never_publish")).toHaveLength(2);
  });

  it("drops items whose most probable option is none", () => {
    const none = scored("none", 0.95);
    const result = selectItems({
      scored: [
        none,
        scored("design_engineering_craft", 0.9),
        scored("hci_empirical_research", 0.8),
        scored("css_canvas_motion_techniques", 0.7),
      ],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    expect(result.dropped).toContainEqual({ id: none.item.id, reason: "no_category", score: 0.95 });
  });

  it("honours a custom threshold", () => {
    const pool = [
      scored("design_engineering_craft", 0.6),
      scored("hci_empirical_research", 0.55),
      scored("css_canvas_motion_techniques", 0.5),
    ];
    const strict = selectItems({
      scored: pool,
      kind: "regular",
      floor: 3,
      cap: 12,
      threshold: 0.58,
    });
    expect(strict.outcome).toBe("nothing");
    const loose = selectItems({ scored: pool, kind: "regular", floor: 3, cap: 12, threshold: 0.3 });
    expect(loose.selected).toHaveLength(3);
  });
});

describe("floor and caps", () => {
  const craft = (n: number, base = 0.9): ScoredItem[] =>
    Array.from({ length: n }, (_, i) => scored("design_engineering_craft", base - i * 0.001));

  it("returns the nothing outcome below the floor", () => {
    const result = selectItems({ scored: craft(2), kind: "regular", floor: 3, cap: 12 });
    expect(result.outcome).toBe("nothing");
    expect(result.selected).toEqual([]);
    expect(result.qualifying).toBe(2);
  });

  it("publishes exactly at the floor", () => {
    expect(
      selectItems({ scored: craft(3), kind: "regular", floor: 3, cap: 12 }).selected,
    ).toHaveLength(3);
  });

  it("caps a regular digest at 12 and a weekly at 18", () => {
    expect(
      selectItems({ scored: craft(30), kind: "regular", floor: 3, cap: 99 }).selected,
    ).toHaveLength(12);
    expect(
      selectItems({ scored: craft(30), kind: "on-demand", floor: 3, cap: 99 }).selected,
    ).toHaveLength(12);
    expect(
      selectItems({ scored: craft(30), kind: "weekly", floor: 3, cap: 99 }).selected,
    ).toHaveLength(18);
    expect(capFor("weekly")).toBe(18);
    expect(capFor("regular")).toBe(12);
  });

  it("respects a smaller requested cap and records the overflow", () => {
    const result = selectItems({ scored: craft(10), kind: "regular", floor: 3, cap: 5 });
    expect(result.selected).toHaveLength(5);
    expect(result.dropped.filter((d) => d.reason === "over_cap")).toHaveLength(5);
  });

  it("returns nothing when the cap is below the floor", () => {
    expect(selectItems({ scored: craft(10), kind: "regular", floor: 3, cap: 2 }).outcome).toBe(
      "nothing",
    );
  });
});

describe("sections and top picks", () => {
  it("moves the three highest scores to top and out of their home sections", () => {
    const a = scored("design_engineering_craft", 0.95);
    const b = scored("frontier_model_releases", 0.9);
    const c = scored("hci_empirical_research", 0.85);
    const d = scored("developer_tool_launches", 0.6);
    const e = scored("ui_component_primitives", 0.55);
    const result = selectItems({ scored: [e, d, c, b, a], kind: "regular", floor: 3, cap: 12 });
    const bySection = Object.fromEntries(result.selected.map((s) => [s.item.id, s.section]));
    expect(bySection[a.item.id]).toBe("top");
    expect(bySection[b.item.id]).toBe("top");
    expect(bySection[c.item.id]).toBe("top");
    // Library, framework and changelog news files under Launches, read last (2026-10-18).
    expect(bySection[d.item.id]).toBe("launches");
    expect(bySection[e.item.id]).toBe("ui-craft");
    expect(result.selected.filter((s) => s.section === "top")).toHaveLength(3);
  });

  it("orders output top first, then sections in digest order, each by score", () => {
    const pool = [
      scored("developer_tool_launches", 0.5),
      scored("hci_empirical_research", 0.6),
      scored("frontier_model_releases", 0.7),
      scored("ui_component_primitives", 0.8),
      scored("design_engineering_craft", 0.9),
      scored("css_canvas_motion_techniques", 0.95),
    ];
    const result = selectItems({ scored: pool, kind: "regular", floor: 3, cap: 12 });
    expect(result.selected.map((s) => s.section)).toEqual([
      "top",
      "top",
      "top",
      "design",
      "ai",
      "launches",
    ]);
  });

  it("files a video in the section of its category, since watch no longer receives stories", () => {
    const video = scored("css_canvas_motion_techniques", 0.5, { source_type: "youtube" });
    const result = selectItems({
      scored: [
        scored("design_engineering_craft", 0.9),
        scored("hci_empirical_research", 0.8),
        scored("frontier_model_releases", 0.7),
        video,
      ],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    expect(result.selected.find((s) => s.item.id === video.item.id)?.section).toBe("ui-craft");
  });

  it("takes at most three per home section while other sections still have items", () => {
    const craft = Array.from({ length: 6 }, (_, i) =>
      scored("design_engineering_craft", 0.95 - i * 0.01),
    );
    const ai = scored("frontier_model_releases", 0.5);
    const research = scored("hci_empirical_research", 0.5);
    // A second AI story stands in for the launch story, which now shares Design Engineering with craft.
    const launch = scored("frontier_model_releases", 0.5);
    const result = selectItems({
      scored: [...craft, ai, research, launch],
      kind: "regular",
      floor: 3,
      cap: 6,
    });
    const chosen = new Set(ids(result.selected));
    expect(chosen.size).toBe(6);
    expect(craft.slice(0, SECTION_TARGET_MAX).every((c) => chosen.has(c.item.id))).toBe(true);
    expect(craft.slice(SECTION_TARGET_MAX).some((c) => chosen.has(c.item.id))).toBe(false);
    for (const other of [ai, research, launch]) expect(chosen.has(other.item.id)).toBe(true);
  });

  it("lets overflow fill the cap when other sections are thin", () => {
    const craft = Array.from({ length: 5 }, (_, i) =>
      scored("design_engineering_craft", 0.9 - i * 0.01),
    );
    const result = selectItems({ scored: craft, kind: "regular", floor: 3, cap: 12 });
    expect(result.selected).toHaveLength(5);
  });

  it("recomputes top picks when items are removed later", () => {
    const first = selectItems({
      scored: [
        scored("design_engineering_craft", 0.9),
        scored("hci_empirical_research", 0.8),
        scored("frontier_model_releases", 0.7),
        scored("ui_component_primitives", 0.6),
      ],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    const survivors = first.selected.filter((s) => s.score !== 0.9);
    const again = assignSections(survivors);
    expect(again.filter((s) => s.section === "top")).toHaveLength(3);
    expect(again.find((s) => s.score === 0.6)?.section).toBe("top");
  });

  it("is idempotent", () => {
    const result = selectItems({
      scored: [
        scored("design_engineering_craft", 0.9),
        scored("hci_empirical_research", 0.8),
        scored("frontier_model_releases", 0.7),
        scored("developer_tool_launches", 0.6),
      ],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    expect(assignSections(result.selected)).toEqual(result.selected);
  });
});

describe("tie-breaking and determinism", () => {
  it("breaks equal scores by newer publish date, then by id", () => {
    const old = scored("design_engineering_craft", 0.8, { published_at: "2026-10-01T00:00:00Z" });
    const fresh = scored("design_engineering_craft", 0.8, { published_at: "2026-10-04T00:00:00Z" });
    const undated = scored("design_engineering_craft", 0.8);
    const order = [old, undated, fresh]
      .map((s) => ({ item: s.item, score: s.score }))
      .sort(compareCandidates)
      .map((s) => s.item.id);
    expect(order).toEqual([fresh.item.id, old.item.id, undated.item.id]);
  });

  it("breaks full ties by ascending id", () => {
    const a = scored("design_engineering_craft", 0.8, { published_at: "2026-10-04T00:00:00Z" });
    const b = scored("design_engineering_craft", 0.8, { published_at: "2026-10-04T00:00:00Z" });
    const order = [b, a].map((s) => ({ item: s.item, score: s.score })).sort(compareCandidates);
    expect(order[0]?.item.id).toBe(a.item.id);
  });

  it("selects the same items in the same order for any input order", () => {
    const pool = Array.from({ length: 16 }, (_, i) =>
      scored(
        (
          [
            "design_engineering_craft",
            "frontier_model_releases",
            "hci_empirical_research",
            "developer_tool_launches",
          ] as const
        )[i % 4] as Category,
        0.5 + ((i * 7) % 5) / 20,
        { published_at: `2026-10-0${(i % 5) + 1}T00:00:00Z` },
      ),
    );
    const baseline = selectItems({ scored: pool, kind: "regular", floor: 3, cap: 8 });
    for (const shift of [1, 5, 9]) {
      const rotated = [...pool.slice(shift), ...pool.slice(0, shift)];
      const reversed = [...rotated].reverse();
      for (const variant of [rotated, reversed]) {
        const result = selectItems({ scored: variant, kind: "regular", floor: 3, cap: 8 });
        expect(result.selected.map((s) => [s.item.id, s.section])).toEqual(
          baseline.selected.map((s) => [s.item.id, s.section]),
        );
      }
    }
  });

  it("does not mutate its input", () => {
    const pool = [
      scored("design_engineering_craft", 0.9),
      scored("hci_empirical_research", 0.8),
      scored("frontier_model_releases", 0.7),
    ];
    const before = JSON.stringify(pool);
    selectItems({ scored: pool, kind: "regular", floor: 3, cap: 12 });
    expect(JSON.stringify(pool)).toBe(before);
  });
});

describe("topics and length", () => {
  // Before: three craft stories filled a section's target and the cap, so a selected topic with a
  // story over the bar (motion techniques) never aired.
  it("airs every topic's best story before a stronger topic's second", () => {
    const craft = Array.from({ length: 4 }, (_, i) =>
      scored("design_engineering_craft", 0.9 - i * 0.01),
    );
    const motion = scored("css_canvas_motion_techniques", 0.5);
    const result = selectItems({ scored: [...craft, motion], kind: "regular", floor: 3, cap: 3 });
    expect(ids(result.selected)).toContain(motion.item.id);
  });

  // Before: Tech releases and each general section were added on top of the cap, so a short
  // briefing ran long, and five tech stories could take the airtime from every other section.
  it("holds every section together to the briefing's length, one story per section first", () => {
    const craft = Array.from({ length: 6 }, (_, i) =>
      scored("design_engineering_craft", 0.9 - i * 0.01),
    );
    const tech = Array.from({ length: 5 }, (_, i) =>
      scored("consumer_tech_releases", 0.8 - i * 0.01),
    );
    const result = selectItems({
      scored: [...craft, ...tech],
      kind: "regular",
      floor: 3,
      cap: 12,
      total: 5,
    });
    expect(result.selected).toHaveLength(5);
    expect(result.selected.filter(isTech)).toHaveLength(1);
  });

  // Before: a weekly set to 15 minutes stopped at 18 main stories (about 9 minutes), whatever
  // the setting.
  it("lets the owner's length, not the kind's count cap, size a briefing", () => {
    const craft = Array.from({ length: 30 }, (_, i) =>
      scored("design_engineering_craft", 0.9 - i * 0.001),
    );
    const result = selectItems({ scored: craft, kind: "weekly", floor: 3, cap: 48, total: 25 });
    expect(result.selected).toHaveLength(25);
    const unsized = selectItems({ scored: craft, kind: "weekly", floor: 3, cap: 48 });
    expect(unsized.selected).toHaveLength(capFor("weekly"));
    // The 2026-10-18 weekly: its spares stopped at the digest's 48, below what grounding loses.
    const week = Array.from({ length: 80 }, (_, i) =>
      scored("design_engineering_craft", 0.9 - i * 0.001),
    );
    const spares = selectItems({ scored: week, kind: "weekly", floor: 3, cap: 70, total: 70 });
    expect(spares.selected).toHaveLength(70);
  });
});

describe("release notes", () => {
  // Package release notes cleared the bar and filled a third of the October weekly (loop/NOTES.md,
  // I1), and the 2026-10-18 weekly opened its Top picks on a shadcn release.
  it("keeps patch releases out, holds release notes to a small share and reads them last", () => {
    const releases = ["kit 1.0", "@acme/ui@2.1.0", "tool 0.16", "lib v3.0", "cli 4.2"].map(
      (title, i) => scored("developer_tool_launches", 0.95 - i * 0.01, { title }),
    );
    const patch = scored("ui_component_primitives", 0.99, {
      title: "shadcn 4.21.5 updates dependencies",
    });
    const posts = Array.from({ length: 30 }, (_, i) =>
      scored("design_engineering_craft", 0.8 - i * 0.001, { title: "Qwen3.8 reads 20.1% faster" }),
    );
    const result = selectItems({
      scored: [patch, ...releases, ...posts],
      kind: "weekly",
      floor: 1,
      cap: 48,
      total: 20,
    });
    expect(result.selected).toHaveLength(20);
    expect(ids(result.selected).filter((id) => ids(releases).includes(id))).toEqual([
      releases[0]?.item.id,
    ]);
    expect(result.dropped.find((d) => d.id === patch.item.id)?.reason).toBe("release_note");
    // It outscores every post, and still is no Top pick and closes the briefing.
    expect(result.selected.at(-1)?.item.id).toBe(releases[0]?.item.id);
    expect(result.selected.at(-1)?.section).toBe("launches");
  });
});

describe("same story", () => {
  // The October weekly told Mistral Large 4, ColorOS 17 and ttok twice each (loop/results/iteration-6.md).
  it("airs one telling of a story, and never a release note in place of the news", () => {
    const plugin = scored("developer_tool_launches", 0.95, {
      title: "llm-mistral 0.16 adds Mistral Large 4 support",
    });
    const launch = scored("frontier_model_releases", 0.9, {
      title: "Mistral Large 4 scores high on cyber tasks but costs more",
    });
    const specs = scored("frontier_model_releases", 0.85, {
      title: "Mistral Large 4 has 1T parameters, 49B active",
    });
    const beta = scored("consumer_tech_releases", 0.8, {
      title: "OnePlus 15 gets ColorOS 17 beta before OPPO's global launch",
    });
    const rollout = scored("consumer_tech_releases", 0.75, {
      title: "Color OS 17 rollout starts October 29 for OnePlus and realme",
    });
    const newer = scored("developer_tool_launches", 0.7, { title: "ttok 1.0 defaults to GPT-5" });
    const older = scored("developer_tool_launches", 0.65, { title: "ttok 0.4 adds model listing" });
    const samsung = scored("consumer_tech_releases", 0.6, {
      title: "Samsung rolls out Android 17 to Galaxy S24",
    });
    const result = selectItems({
      scored: [plugin, launch, specs, beta, rollout, newer, older, samsung],
      kind: "weekly",
      floor: 1,
      cap: 48,
      total: 20,
    });
    expect(ids(result.selected).sort()).toEqual(ids([launch, beta, newer, samsung]).sort());
    expect(
      result.dropped
        .filter((d) => d.reason === "same_story")
        .map((d) => d.id)
        .sort(),
    ).toEqual(ids([plugin, specs, rollout, older]).sort());
  });
});

describe("weekly reserved slot", () => {
  const build = (): ScoredItem[] => [
    ...Array.from({ length: 3 }, (_, i) => scored("design_engineering_craft", 0.9 - i * 0.01)),
    ...Array.from({ length: 3 }, (_, i) => scored("ai_ux_interaction_patterns", 0.86 - i * 0.01)),
    ...Array.from({ length: 3 }, (_, i) => scored("hci_empirical_research", 0.8 - i * 0.01)),
  ];

  it("computes the median of the twelve weights: the mean of the middle two", () => {
    expect(Object.keys(weights)).toHaveLength(12);
    // Sorted: 0.02, 0.1, 0.8, 0.82, 0.85, [0.85, 0.85], 0.88, 0.9, 0.92, 0.92, 0.95.
    expect(medianWeight(weights)).toBe(0.85);
  });

  it("moves with the weights: one category raised above the middle shifts the median up", () => {
    expect(medianWeight({ ...weights, consumer_tech_releases: 0.9 })).toBe(0.865);
    expect(medianWeight({ ...weights, consumer_tech_releases: 0 })).toBe(0.85);
  });

  it("guarantees one slot to the best below-median category in a weekly digest", () => {
    // Three slots for four topics: every topic's best story competes for them, so the launch
    // gets in only through the reserved slot.
    const launch = scored("developer_tool_launches", 0.45);
    const pool = [...build(), launch];
    const weekly = selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 3, weights });
    expect(weekly.selected).toHaveLength(3);
    expect(ids(weekly.selected)).toContain(launch.item.id);
    const regular = selectItems({ scored: pool, kind: "regular", floor: 3, cap: 3, weights });
    expect(ids(regular.selected)).not.toContain(launch.item.id);
  });

  it("picks the best-ranked below-median item as the reserve", () => {
    const worse = scored("developer_tool_launches", 0.42);
    const better = scored("developer_tool_launches", 0.47);
    const weekly = selectItems({
      scored: [...build(), worse, better],
      kind: "weekly",
      floor: 3,
      cap: 6,
      weights,
    });
    expect(ids(weekly.selected)).toContain(better.item.id);
    expect(ids(weekly.selected)).not.toContain(worse.item.id);
  });

  it("reserves nothing for a category whose weight sits exactly at the median", () => {
    // Taste essays and frontier models weigh 0.85, the median itself, so they are not below it.
    expect(weights.taste_and_design_philosophy).toBe(medianWeight(weights));
    const atMedian = scored("taste_and_design_philosophy", 0.47);
    const pool = [...build(), atMedian];
    const weekly = selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 3, weights });
    expect(ids(weekly.selected)).not.toContain(atMedian.item.id);
  });

  it("never spends the reserved slot on a tech candidate, which has its own allowance", () => {
    expect(weights.consumer_tech_releases).toBeLessThan(medianWeight(weights));
    const techItem = scored("consumer_tech_releases", 0.6);
    const launch = scored("developer_tool_launches", 0.45);
    const pool = [...build(), techItem, launch];
    const weekly = selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 6, weights });
    // Six capped slots, one of them the reserved launch, plus the tech story on top.
    expect(weekly.selected).toHaveLength(7);
    expect(ids(weekly.selected)).toContain(launch.item.id);
    expect(weekly.selected.filter((s) => !isTech(s))).toHaveLength(6);
    expect(weekly.selected.find((s) => s.item.id === techItem.item.id)?.section).toBe("tech");
  });

  it("changes nothing when a below-median item is already selected", () => {
    const launch = scored("developer_tool_launches", 0.95);
    const pool = [...build(), launch];
    const withWeights = selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 6, weights });
    const without = selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 6 });
    expect(ids(withWeights.selected)).toEqual(ids(without.selected));
  });

  it("changes nothing without weights or without a below-median candidate", () => {
    const pool = build();
    const base = selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 6 });
    const same = selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 6, weights });
    expect(ids(same.selected)).toEqual(ids(base.selected));
  });

  it("does not exceed the cap when it adds the reserve", () => {
    const pool = [...build(), scored("developer_tool_launches", 0.45)];
    expect(
      selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 4, weights }).selected,
    ).toHaveLength(4);
  });
});

describe("the tech allowance", () => {
  const craft = (n: number, base = 0.9): ScoredItem[] =>
    Array.from({ length: n }, (_, i) => scored("design_engineering_craft", base - i * 0.001));
  const tech = (n: number, base = 0.7): ScoredItem[] =>
    Array.from({ length: n }, (_, i) => scored("consumer_tech_releases", base - i * 0.01));
  const select = (pool: ScoredItem[], kind: "regular" | "weekly" = "regular", cap = 99) =>
    selectItems({ scored: pool, kind, floor: 3, cap });
  const count = (result: ReturnType<typeof select>, section: string): number =>
    result.selected.filter((s) => s.section === section).length;

  it("is five stories, the same number the voice limits state", () => {
    expect(TECH_ALLOWANCE).toBe(5);
    expect(VOICE_LIMITS.items.techCap).toBe(5);
  });

  it("takes up to five tech stories on top of the cap of twelve", () => {
    const result = select([...craft(30), ...tech(8)]);
    expect(result.selected).toHaveLength(17);
    expect(count(result, "tech")).toBe(5);
    expect(result.selected.filter((s) => !isTech(s))).toHaveLength(12);
  });

  it("adds the same five to a weekly digest of eighteen", () => {
    const result = select([...craft(30), ...tech(8)], "weekly");
    expect(result.selected).toHaveLength(23);
    expect(count(result, "tech")).toBe(5);
    expect(result.selected.length).toBeLessThanOrEqual(24);
  });

  it("keeps the five best tech stories by rank and records the rest as over the tech cap", () => {
    const pool = tech(8);
    const result = select([...craft(4), ...pool]);
    const chosen = result.selected.filter(isTech).map((s) => s.item.id);
    expect(chosen).toEqual(ids(pool.slice(0, 5)));
    expect(result.dropped.filter((d) => d.reason === "over_tech_cap").map((d) => d.id)).toEqual(
      ids(pool.slice(5)),
    );
    expect(result.dropped.some((d) => d.reason === "over_cap")).toBe(false);
  });

  it("never lends tech slots to other sections or borrows from them", () => {
    // A small cap is not raised by the tech allowance, and a thin tech pool leaves it unused.
    const small = select([...craft(10), ...tech(5)], "regular", 5);
    expect(small.selected.filter((s) => !isTech(s))).toHaveLength(5);
    expect(count(small, "tech")).toBe(5);
    expect(small.dropped.filter((d) => d.reason === "over_cap")).toHaveLength(5);

    const thin = select([...craft(30), ...tech(1)]);
    expect(thin.selected).toHaveLength(13);
    expect(count(thin, "tech")).toBe(1);
  });

  it("does not hold tech to three per section", () => {
    expect(SECTION_TARGET_MAX).toBe(3);
    const others = [
      scored("frontier_model_releases", 0.9),
      scored("hci_empirical_research", 0.9),
      scored("developer_tool_launches", 0.9),
    ];
    const result = select([...craft(3), ...others, ...tech(5)], "regular", 6);
    expect(count(result, "tech")).toBe(5);
  });

  it("never makes a tech story a Top pick, however high it scores", () => {
    const loud = tech(5, 0.99);
    const quiet = [
      scored("design_engineering_craft", 0.6),
      scored("hci_empirical_research", 0.55),
      scored("frontier_model_releases", 0.5),
      scored("developer_tool_launches", 0.45),
    ];
    const result = select([...loud, ...quiet]);
    const top = result.selected.filter((s) => s.section === "top");
    expect(top).toHaveLength(TOP_PICKS);
    expect(top.map((s) => s.score)).toEqual([0.6, 0.55, 0.5]);
    expect(top.some(isTech)).toBe(false);
    for (const item of loud) {
      expect(result.selected.find((s) => s.item.id === item.item.id)?.section).toBe("tech");
    }
  });

  it("lists the sections in the order of the contract, releases last", () => {
    expect(SECTIONS).toEqual([
      "top",
      "design",
      "ui-craft",
      "software",
      "ai",
      "tech",
      "trending",
      "research",
      "launches",
      "watch",
    ]);
    const result = select([
      ...tech(2),
      scored("design_engineering_craft", 0.9),
      scored("ui_component_primitives", 0.88),
      scored("css_canvas_motion_techniques", 0.86),
      scored("design_engineering_craft", 0.5),
      scored("frontier_model_releases", 0.5),
      scored("hci_empirical_research", 0.5),
      scored("developer_tool_launches", 0.5),
      scored("css_canvas_motion_techniques", 0.5, { source_type: "youtube" }),
    ]);
    expect(result.selected.map((s) => s.section)).toEqual([
      "top",
      "top",
      "top",
      "design",
      "ui-craft",
      "ui-craft",
      "ai",
      "tech",
      "tech",
      "launches",
    ]);
  });

  it("counts craft and tech together against the floor of three", () => {
    const mixed = select([...craft(2), ...tech(1)]);
    expect(mixed.outcome).toBe("selected");
    expect(mixed.selected).toHaveLength(3);
    // Two items outside tech, so two Top picks.
    expect(count(mixed, "top")).toBe(2);
    expect(count(mixed, "tech")).toBe(1);

    const short = select([...craft(1), ...tech(1)]);
    expect(short.outcome).toBe("nothing");
    expect(short.selected).toEqual([]);
    expect(short.qualifying).toBe(2);
    expect(short.dropped).toEqual([]);
  });

  it("publishes a digest of tech stories alone, with no Top picks", () => {
    const result = select(tech(4));
    expect(result.outcome).toBe("selected");
    expect(result.selected.map((s) => s.section)).toEqual(["tech", "tech", "tech", "tech"]);
  });

  it("does not let more than five tech stories stand in for the floor", () => {
    // Only what is chosen counts: two capped slots and five tech stories is seven, not twelve.
    const result = select([...craft(10), ...tech(9)], "regular", 2);
    expect(result.selected).toHaveLength(7);
  });

  it("counts a tech video in the tech allowance, since watch no longer receives stories", () => {
    const video = scored("consumer_tech_releases", 0.5, { source_type: "youtube" });
    const result = select([...craft(12), ...tech(5), video]);
    // Twelve capped slots plus five tech stories; the video competes for the tech allowance.
    expect(result.selected).toHaveLength(17);
    expect(count(result, "tech")).toBe(5);
    expect(result.selected.filter((s) => !isTech(s))).toHaveLength(12);
    expect(result.dropped.filter((d) => d.reason === "over_cap")).toHaveLength(0);

    // With six tech stories and a video, two are over the allowance of five.
    const full = select([...craft(3), ...tech(6), video]);
    expect(count(full, "tech")).toBe(5);
    expect(full.dropped.filter((d) => d.reason === "over_tech_cap")).toHaveLength(2);
  });

  it("drops a tech story below the threshold before the allowance is counted", () => {
    const rumour = scored("consumer_tech_releases", 0.28);
    const result = select([...craft(3), ...tech(4), rumour]);
    expect(count(result, "tech")).toBe(4);
    expect(result.dropped).toContainEqual({
      id: rumour.item.id,
      reason: "below_threshold",
      score: 0.28,
    });
  });

  it("recomputes Top picks from the items outside tech when later stages drop some", () => {
    const first = select([...craft(4), ...tech(3, 0.99)]);
    const survivors = first.selected.filter((s) => s.score !== 0.9);
    const again = assignSections(survivors);
    expect(again.filter((s) => s.section === "top")).toHaveLength(3);
    expect(again.filter((s) => s.section === "top").some(isTech)).toBe(false);
    const fewer = assignSections(first.selected.filter((s) => isTech(s) || s.score === 0.9));
    expect(fewer.map((s) => s.section)).toEqual(["top", "tech", "tech", "tech"]);
  });

  it("is idempotent and independent of input order with tech in the pool", () => {
    const pool = [...craft(6), ...tech(7)];
    const baseline = select(pool, "regular", 4);
    expect(assignSections(baseline.selected)).toEqual(baseline.selected);
    const shuffled = select([...pool].reverse(), "regular", 4);
    expect(shuffled.selected.map((s) => [s.item.id, s.section])).toEqual(
      baseline.selected.map((s) => [s.item.id, s.section]),
    );
  });
});

describe("scoring and selection together", () => {
  it("publishes deep craft and drops hype, funding and unplaceable items", () => {
    const prefs = plainPreferences();
    const make = (opts: Parameters<typeof makeEntry>[1]): ScoredItem => {
      const item = makeItem();
      return scoreItem(makeEntry(item, opts), prefs, item);
    };
    const keep = [
      make({ category: "design_engineering_craft", p: 0.9, depth: 0.9 }),
      make({ category: "css_canvas_motion_techniques", p: 0.85, depth: 0.75 }),
      make({ category: "ai_ux_interaction_patterns", p: 0.8, depth: 0.5 }),
    ];
    const hype = make({ category: "generic_ai_hype_listicles", p: 0.9, depth: 0, hype: 0.95 });
    const funding = make({
      category: "venture_capital_and_gossip",
      p: 0.9,
      depth: 0.2,
      funding: 0.9,
    });
    const vague = make({ category: "design_engineering_craft", p: 0.3, depth: 0.1 });
    const result = selectItems({
      scored: [hype, funding, vague, ...keep],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    expect(result.outcome).toBe("selected");
    expect(ids(result.selected).sort()).toEqual(ids(keep).sort());
  });

  it("publishes launches by scale and leaves rumours, deals and accessories out", () => {
    const prefs = plainPreferences();
    const make = (opts: Parameters<typeof makeEntry>[1]): ScoredItem => {
      const item = makeItem();
      return scoreItem(makeEntry(item, opts), prefs, item);
    };
    const launch = (launchScale: number): ScoredItem =>
      make({ category: "consumer_tech_releases", p: 0.9, depth: 0, launchScale });
    const craft = [
      make({ category: "design_engineering_craft", p: 0.9, depth: 0.9 }),
      make({ category: "css_canvas_motion_techniques", p: 0.85, depth: 0.75 }),
      make({ category: "ai_ux_interaction_patterns", p: 0.8, depth: 0.5 }),
    ];
    const flagship = launch(0.75);
    const newProduct = launch(0.5);
    const refresh = launch(0.25);
    const rumour = launch(0);
    const result = selectItems({
      scored: [rumour, refresh, newProduct, flagship, ...craft],
      kind: "regular",
      floor: 3,
      cap: 12,
    });
    const techIds = result.selected.filter((s) => s.section === "tech").map((s) => s.item.id);
    expect(techIds).toEqual([flagship.item.id, newProduct.item.id, refresh.item.id]);
    expect(result.dropped).toContainEqual({
      id: rumour.item.id,
      reason: "below_threshold",
      score: 0.252,
    });
    // The flagship outscores one craft item and still stays out of the Top picks.
    expect(flagship.score).toBeGreaterThan(craft[2]?.score ?? 1);
    expect(result.selected.filter((s) => s.section === "top").map((s) => s.item.id)).toEqual(
      ids(craft),
    );
  });
});

describe("one release per repository", () => {
  const release = (repo: string, tag: string, score: number, publishedAt: string): ScoredItem =>
    scored("design_engineering_craft", score, {
      url: `https://github.com/${repo}/releases/tag/${tag}`,
      canonical_url: `https://github.com/${repo}/releases/tag/${tag}`,
      title: `${repo}: ${tag}`,
      source_id: repo.replace("/", "-"),
      source_type: "github",
      published_at: publishedAt,
    });
  const select = (pool: ScoredItem[]) =>
    selectItems({ scored: pool, kind: "regular", floor: 1, cap: 12 });

  it("reads the repository from a github.com URL, else the source id", () => {
    expect(releaseRepo(release("Vercel/Next.js", "v1.0.1", 0.5, "2026-10-05T00:00:00Z").item)).toBe(
      "vercel/next.js",
    );
    const feed = makeItem({
      source_type: "github",
      source_id: "tool",
      url: "https://example.com/x",
    });
    expect(releaseRepo(feed)).toBe("source:tool");
    expect(releaseRepo(makeItem())).toBeNull();
  });

  it("keeps the newest of several releases, even when an older one scores higher", () => {
    const older = release("acme/kit", "v1.3.0", 0.9, "2026-10-04T00:00:00Z");
    const newer = release("acme/kit", "v1.4.0", 0.6, "2026-10-05T00:00:00Z");
    const oldest = release("acme/kit", "v1.2.0", 0.8, "2026-10-03T00:00:00Z");
    const result = select([older, newer, oldest]);
    expect(ids(result.selected)).toEqual([newer.item.id]);
    expect(
      result.dropped
        .filter((d) => d.reason === "same_repo_release")
        .map((d) => d.id)
        .sort(),
    ).toEqual([older.item.id, oldest.item.id].sort());
  });

  it("leaves releases of different repositories and non-release items alone", () => {
    const a = release("acme/kit", "v1.4.0", 0.6, "2026-10-05T00:00:00Z");
    const b = release("acme/other", "v3.0.0", 0.6, "2026-10-05T00:00:00Z");
    const post = scored("design_engineering_craft", 0.7);
    // Release notes take 6% of the briefing, so two need a briefing of 34.
    const result = selectItems({
      scored: [a, b, post],
      kind: "regular",
      floor: 1,
      cap: 40,
      total: 40,
    });
    expect(result.selected).toHaveLength(3);
    expect(result.dropped).toEqual([]);
  });

  it("ignores releases that never cleared the bar", () => {
    const low = release("acme/kit", "v1.5.0", 0.1, "2026-10-06T00:00:00Z");
    const kept = release("acme/kit", "v1.4.0", 0.6, "2026-10-05T00:00:00Z");
    const result = select([low, kept]);
    expect(ids(result.selected)).toEqual([kept.item.id]);
    expect(result.dropped.map((d) => d.reason)).toEqual(["below_threshold"]);
  });

  it("breaks a tie on the publish date by rank", () => {
    const pool = [
      release("acme/kit", "v1.2.3", 0.5, "2026-10-05T00:00:00Z"),
      release("acme/kit", "v1.2.4", 0.7, "2026-10-05T00:00:00Z"),
    ];
    const candidates = pool.map((s) => ({
      item: s.item,
      category: "design_engineering_craft" as const,
      home: "craft",
      score: s.score,
    }));
    expect(newestReleasePerRepo(candidates).kept.map((c) => c.score)).toEqual([0.7]);
  });
});

describe("the outlet cap", () => {
  it("keeps a third story from one outlet out, even when its feeds are separate sources", () => {
    const pool = [
      scored("design_engineering_craft", 0.9, {
        source_id: "loud-a",
        url: "https://www.loud.example/a",
      }),
      scored("frontier_model_releases", 0.85, {
        source_id: "loud-b",
        url: "https://loud.example/b",
      }),
      scored("hci_empirical_research", 0.8, { source_id: "loud-c", url: "https://loud.example/c" }),
      scored("developer_tool_launches", 0.6, { source_id: "quiet" }),
    ];
    const result = selectItems({ scored: pool, kind: "regular", floor: 1, cap: 10, weights });
    expect(result.selected.filter((s) => s.item.url.includes("loud.example"))).toHaveLength(2);
    expect(result.dropped.map((d) => d.reason)).toContain("over_outlet");
    expect(ids(result.selected)).toContain(pool[3]?.item.id);
  });
});
