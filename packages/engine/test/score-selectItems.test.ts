import type { Category, Item } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { scoreItem } from "../src/score/scoreItem.js";
import {
  assignSections,
  capFor,
  compareCandidates,
  DEFAULT_SCORE_THRESHOLD,
  medianWeight,
  SECTION_TARGET_MAX,
  selectItems,
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

  it("never publishes venture or hype categories, whatever their score", () => {
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
      "ai",
      "research",
      "launches",
    ]);
  });

  it("sends video items to watch by source type", () => {
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
    expect(result.selected.find((s) => s.item.id === video.item.id)?.section).toBe("watch");
  });

  it("takes at most three per home section while other sections still have items", () => {
    const craft = Array.from({ length: 6 }, (_, i) =>
      scored("design_engineering_craft", 0.95 - i * 0.01),
    );
    const ai = scored("frontier_model_releases", 0.5);
    const research = scored("hci_empirical_research", 0.5);
    const launch = scored("developer_tool_launches", 0.5);
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
        scored("developer_tool_launches", 0.6),
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

describe("weekly reserved slot", () => {
  const build = (): ScoredItem[] => [
    ...Array.from({ length: 3 }, (_, i) => scored("design_engineering_craft", 0.9 - i * 0.01)),
    ...Array.from({ length: 3 }, (_, i) => scored("ai_ux_interaction_patterns", 0.86 - i * 0.01)),
    ...Array.from({ length: 3 }, (_, i) => scored("hci_empirical_research", 0.8 - i * 0.01)),
  ];

  it("computes the median of the ten weights", () => {
    expect(medianWeight(weights)).toBeCloseTo(0.865, 6);
  });

  it("guarantees one slot to the best below-median category in a weekly digest", () => {
    const launch = scored("developer_tool_launches", 0.45);
    const pool = [...build(), launch];
    const weekly = selectItems({ scored: pool, kind: "weekly", floor: 3, cap: 6, weights });
    expect(weekly.selected).toHaveLength(6);
    expect(ids(weekly.selected)).toContain(launch.item.id);
    const regular = selectItems({ scored: pool, kind: "regular", floor: 3, cap: 6, weights });
    expect(ids(regular.selected)).not.toContain(launch.item.id);
  });

  it("picks the best-ranked below-median item as the reserve", () => {
    const worse = scored("developer_tool_launches", 0.42);
    const better = scored("taste_and_design_philosophy", 0.47);
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
});
