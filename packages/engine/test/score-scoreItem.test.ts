import { describe, expect, it } from "vitest";
import {
  BONUS,
  CRAFT_FLOOR,
  craftFactor,
  launchFactor,
  penaltyFactor,
  preferenceBonus,
  scoreItem,
  TECH_FLOOR,
  taste,
  topCategory,
} from "../src/score/scoreItem.js";
import { DEFAULT_SCORE_THRESHOLD, eligibility } from "../src/score/selectItems.js";
import { makeEntry, makeItem, plainPreferences, realPreferences } from "./score-factories.js";

const prefs = plainPreferences();

describe("craftFactor", () => {
  it("keeps 55 percent for an announcement, all of it for shown mechanism", () => {
    expect(craftFactor(0)).toBeCloseTo(CRAFT_FLOOR, 6);
    expect(craftFactor(1)).toBe(1);
  });

  it("is concave: the first half of depth earns more than the second", () => {
    expect(craftFactor(0.5)).toBeCloseTo(0.8875, 6);
    expect(craftFactor(0.5) - craftFactor(0)).toBeGreaterThan(craftFactor(1) - craftFactor(0.5));
  });

  it("rises monotonically and clamps out-of-range depth", () => {
    const values = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(craftFactor);
    for (let i = 1; i < values.length; i++) {
      expect(values[i] as number).toBeGreaterThan(values[i - 1] as number);
    }
    expect(craftFactor(-3)).toBe(craftFactor(0));
    expect(craftFactor(7)).toBe(1);
  });
});

describe("launchFactor", () => {
  it("starts at the tech floor, below the craft floor, and reaches 1", () => {
    expect(TECH_FLOOR).toBe(0.35);
    expect(TECH_FLOOR).toBeLessThan(CRAFT_FLOOR);
    expect(launchFactor(0)).toBeCloseTo(0.35, 6);
    expect(launchFactor(1)).toBe(1);
  });

  it("follows the same concave curve as craft depth", () => {
    expect(launchFactor(0.25)).toBeCloseTo(0.634375, 6);
    expect(launchFactor(0.5)).toBeCloseTo(0.8375, 6);
    expect(launchFactor(0.75)).toBeCloseTo(0.959375, 6);
    expect(launchFactor(0.5) - launchFactor(0)).toBeGreaterThan(
      launchFactor(1) - launchFactor(0.5),
    );
    for (const depth of [0, 0.25, 0.5, 0.75, 1]) {
      const span = (value: number, floor: number): number => (value - floor) / (1 - floor);
      expect(span(launchFactor(depth), TECH_FLOOR)).toBeCloseTo(
        span(craftFactor(depth), CRAFT_FLOOR),
        6,
      );
    }
  });

  it("rises monotonically and clamps out-of-range values", () => {
    const values = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(launchFactor);
    for (let i = 1; i < values.length; i++) {
      expect(values[i] as number).toBeGreaterThan(values[i - 1] as number);
    }
    expect(launchFactor(-3)).toBe(launchFactor(0));
    expect(launchFactor(7)).toBe(1);
  });
});

describe("penaltyFactor", () => {
  it("applies the documented penalties at probability 1", () => {
    expect(penaltyFactor({ hype: 1, sponsored: 0, funding: 0 })).toBeCloseTo(0.4, 6);
    expect(penaltyFactor({ hype: 0, sponsored: 1, funding: 0 })).toBeCloseTo(0.5, 6);
    expect(penaltyFactor({ hype: 0, sponsored: 0, funding: 1 })).toBeCloseTo(0.6, 6);
  });

  it("scales with the probability and multiplies across flags", () => {
    expect(penaltyFactor({ hype: 0.5, sponsored: 0, funding: 0 })).toBeCloseTo(0.7, 6);
    expect(penaltyFactor({ hype: 1, sponsored: 1, funding: 1 })).toBeCloseTo(0.12, 6);
    expect(penaltyFactor({ hype: 0, sponsored: 0, funding: 0 })).toBe(1);
  });
});

describe("taste", () => {
  it("sums probability times the normal taste and ignores the none option", () => {
    const entry = makeEntry("aaaaaaaaaaaa", { category: "design_engineering_craft", p: 0.5 });
    expect(taste(entry.category_probs)).toBeCloseTo(0.35, 6);
  });
});

describe("topCategory", () => {
  it("returns the most probable option", () => {
    const entry = makeEntry("aaaaaaaaaaaa", { category: "css_canvas_motion_techniques", p: 0.7 });
    expect(topCategory(entry.category_probs)).toBe("css_canvas_motion_techniques");
  });

  it("returns none when none is the most probable", () => {
    const entry = makeEntry("aaaaaaaaaaaa", { category: "design_engineering_craft", p: 0.3 });
    expect(topCategory(entry.category_probs)).toBe("none");
  });

  it("breaks category ties by category order and lets a category beat a tied none", () => {
    const base = makeEntry("aaaaaaaaaaaa", { category: "none", p: 1 }).category_probs;
    const tied = { ...base, none: 0.4, design_engineering_craft: 0.3, hci_empirical_research: 0.3 };
    expect(topCategory(tied)).toBe("none");
    const tiedWithNone = {
      ...base,
      none: 0.5,
      hci_empirical_research: 0.25,
      ui_component_primitives: 0.25,
    };
    expect(topCategory(tiedWithNone)).toBe("none");
    const even = {
      ...base,
      none: 0.3,
      hci_empirical_research: 0.35,
      ui_component_primitives: 0.35,
    };
    expect(topCategory(even)).toBe("hci_empirical_research");
    const noneTie = { ...base, none: 0.5, design_engineering_craft: 0.5 };
    expect(topCategory(noneTie)).toBe("design_engineering_craft");
  });

  it("returns none for an all-zero distribution", () => {
    const zero = {
      ...makeEntry("aaaaaaaaaaaa", { category: "none", p: 1 }).category_probs,
      none: 0,
    };
    expect(topCategory(zero)).toBe("none");
  });
});

describe("scoreItem", () => {
  it("scores a certain, deep, clean craft item at its category weight", () => {
    const item = makeItem();
    const result = scoreItem(makeEntry(item, { depth: 1 }), prefs, item);
    expect(result.score).toBe(0.7);
    expect(result.topCategory).toBe("design_engineering_craft");
    expect(result.breakdown).toEqual({ taste: 0.7, craftFactor: 1, penaltyFactor: 1, bonus: 0 });
  });

  it("lowers the score for an announcement with no technique", () => {
    const item = makeItem();
    const deep = scoreItem(makeEntry(item, { depth: 1 }), prefs, item).score;
    const shallow = scoreItem(makeEntry(item, { depth: 0 }), prefs, item).score;
    expect(shallow).toBeCloseTo(0.7 * CRAFT_FLOOR, 3);
    expect(shallow).toBeLessThan(deep);
  });

  it("reduces the score by each flag", () => {
    const item = makeItem();
    const base = scoreItem(makeEntry(item), prefs, item).score;
    expect(scoreItem(makeEntry(item, { hype: 1 }), prefs, item).score).toBeCloseTo(base * 0.4, 3);
    expect(scoreItem(makeEntry(item, { sponsored: 1 }), prefs, item).score).toBeCloseTo(
      base * 0.5,
      3,
    );
    expect(scoreItem(makeEntry(item, { funding: 1 }), prefs, item).score).toBeCloseTo(
      base * 0.6,
      3,
    );
  });

  it("scores an unplaceable item at zero", () => {
    const item = makeItem();
    expect(scoreItem(makeEntry(item, { category: "none", p: 1 }), prefs, item).score).toBe(0);
  });

  it("adds the author bonus only when the item has a preferred author", () => {
    const withAuthor = makeItem({ author: "Emil Kowalski" });
    const without = makeItem({ author: "Someone Else" });
    const real = realPreferences();
    const entry = (item: typeof withAuthor) => makeEntry(item, { depth: 0, p: 0.5 });
    const a = scoreItem(entry(withAuthor), { ...real, preferred_keywords: [] }, withAuthor).score;
    const b = scoreItem(entry(without), { ...real, preferred_keywords: [] }, without).score;
    expect(a - b).toBeCloseTo(BONUS.author, 3);
  });

  it("adds the keyword bonus and caps author plus keyword at 0.05", () => {
    const real = realPreferences();
    const both = makeItem({ author: "Rauno Freiberg", title: "Spring physics for drawers" });
    expect(preferenceBonus(both, real)).toBeCloseTo(0.05, 6);
    const keywordOnly = makeItem({ author: "Nobody", title: "Spring physics for drawers" });
    expect(preferenceBonus(keywordOnly, real)).toBeCloseTo(BONUS.keyword, 6);
    expect(BONUS.author + BONUS.keyword).toBeLessThanOrEqual(BONUS.max);
  });

  it("matches keywords as whole words or phrases, case-insensitively", () => {
    const real = realPreferences();
    expect(preferenceBonus(makeItem({ title: "Notes on MOTION design" }), real)).toBe(
      BONUS.keyword,
    );
    expect(preferenceBonus(makeItem({ title: "Emotion in interfaces" }), real)).toBe(0);
    expect(preferenceBonus(makeItem({ snippet: "A guide to design engineering." }), real)).toBe(
      BONUS.keyword,
    );
    expect(preferenceBonus(makeItem({ title: "A threeXjs demo" }), real)).toBe(0);
    expect(preferenceBonus(makeItem({ title: "A three.js demo" }), real)).toBe(BONUS.keyword);
  });

  it("matches authors by whole name tokens, handles and the source id", () => {
    const real = { ...realPreferences(), preferred_keywords: [] };
    expect(preferenceBonus(makeItem({ author: "Andrej Karpathy" }), real)).toBe(BONUS.author);
    expect(preferenceBonus(makeItem({ author: "@Rauno" }), real)).toBe(BONUS.author);
    expect(preferenceBonus(makeItem({ author: "Raunolf" }), real)).toBe(0);
    expect(preferenceBonus(makeItem({ author: undefined, source_id: "shadcn" }), real)).toBe(
      BONUS.author,
    );
    expect(preferenceBonus(makeItem({ author: "Josh W. Comeau" }), real)).toBe(BONUS.author);
  });

  it("ignores preferred names shorter than three characters", () => {
    const tiny = { ...prefs, preferred_authors: ["jo"] };
    expect(preferenceBonus(makeItem({ author: "Jo Smith" }), tiny)).toBe(0);
  });

  it("never exceeds 1 even with the full bonus", () => {
    const real = realPreferences();
    const item = makeItem({ author: "Emil Kowalski", title: "Spring physics" });
    const result = scoreItem(makeEntry(item, { depth: 1 }), real, item);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeCloseTo(0.75, 6);
  });

  it("is deterministic and leaves its inputs untouched", () => {
    const item = makeItem({ author: "Rauno" });
    const entry = makeEntry(item, { depth: 0.6, p: 0.8, hype: 0.2 });
    const before = JSON.stringify([item, entry, prefs]);
    const first = scoreItem(entry, prefs, item);
    const second = scoreItem(entry, prefs, item);
    expect(second).toEqual(first);
    expect(JSON.stringify([item, entry, prefs])).toBe(before);
  });

  it("leaves a craft item untouched by its launch scale", () => {
    const item = makeItem();
    const without = scoreItem(makeEntry(item, { depth: 0.5 }), prefs, item);
    const withScale = scoreItem(makeEntry(item, { depth: 0.5, launchScale: 1 }), prefs, item);
    expect(withScale.score).toBe(without.score);
    expect(withScale.breakdown).toEqual(without.breakdown);
  });

  it("rounds scores to four decimals", () => {
    const item = makeItem();
    const { score } = scoreItem(makeEntry(item, { depth: 0.37, p: 0.83, hype: 0.11 }), prefs, item);
    expect(score).toBe(Math.round(score * 10_000) / 10_000);
  });
});

describe("scoreItem for consumer tech", () => {
  const TECH = "consumer_tech_releases";
  const tech = (launchScale: number | undefined, extra: Parameters<typeof makeEntry>[1] = {}) => {
    const item = makeItem();
    const entry = makeEntry(item, {
      category: TECH,
      depth: 0,
      ...(launchScale === undefined ? {} : { launchScale }),
      ...extra,
    });
    return scoreItem(entry, prefs, item);
  };

  it.each([
    [0, 0, 0.245],
    [1, 0.25, 0.4441],
    [2, 0.5, 0.5862],
    [3, 0.75, 0.6716],
    [4, 1, 0.7],
  ])("scores launch level %i (scale %d) at %d", (_level, scale, expected) => {
    const result = tech(scale);
    expect(result.topCategory).toBe(TECH);
    expect(result.score).toBe(expected);
    expect(result.breakdown.taste).toBe(0.7);
  });

  it("ranks by launch scale and ignores craft depth, which a launch never has", () => {
    expect(tech(0.5, { depth: 0 }).score).toBe(tech(0.5, { depth: 1 }).score);
    expect(tech(0.75).score).toBeGreaterThan(tech(0.5).score);
    expect(tech(0.5).breakdown.craftFactor).toBe(0.8375);
  });

  it("counts an entry judged before the question existed as level 0", () => {
    const result = tech(undefined);
    expect(result.entry).not.toHaveProperty("launch_scale");
    expect(result.score).toBe(0.245);
    expect(result.breakdown.craftFactor).toBe(0.35);
  });

  it("drops a rumour, deal or accessory under the 0.4 threshold and keeps a routine refresh", () => {
    expect(DEFAULT_SCORE_THRESHOLD).toBe(0.4);
    expect(eligibility(tech(0))).toEqual({ eligible: false, reason: "below_threshold" });
    const refresh = eligibility(tech(0.25));
    expect(refresh.eligible).toBe(true);
    if (refresh.eligible) expect(refresh.candidate.home).toBe("tech");
  });

  it("crosses the threshold between a launch scale of 0.18 and 0.19", () => {
    // 0.7 x (0.35 + 0.65 x (1 - (1 - d)^2)) = 0.4 at d of about 0.188.
    expect(tech(0.18).score).toBeLessThan(0.4);
    expect(eligibility(tech(0.18)).eligible).toBe(false);
    expect(tech(0.19).score).toBeGreaterThanOrEqual(0.4);
    expect(eligibility(tech(0.19)).eligible).toBe(true);
  });

  it("still applies the hype, sponsored and funding penalties", () => {
    expect(tech(0.75, { sponsored: 1 }).score).toBeCloseTo(0.6716 * 0.5, 3);
    expect(tech(0.75, { hype: 1 }).score).toBeCloseTo(0.6716 * 0.4, 3);
    expect(eligibility(tech(0.75, { hype: 1 })).eligible).toBe(false);
  });

  it("uses launch scale only when consumer tech is the most probable category", () => {
    const item = makeItem();
    const base = makeEntry(item, { category: "developer_tool_launches", p: 0.55, depth: 1 });
    const mixed = {
      ...base,
      category_probs: { ...base.category_probs, none: 0, consumer_tech_releases: 0.45 },
      launch_scale: 0,
    };
    const asDevTool = scoreItem(mixed, prefs, item);
    expect(asDevTool.topCategory).toBe("developer_tool_launches");
    expect(asDevTool.breakdown.craftFactor).toBe(1);

    const flipped = {
      ...mixed,
      category_probs: {
        ...mixed.category_probs,
        developer_tool_launches: 0.45,
        consumer_tech_releases: 0.55,
      },
    };
    const asTech = scoreItem(flipped, prefs, item);
    expect(asTech.topCategory).toBe(TECH);
    expect(asTech.breakdown.craftFactor).toBe(0.35);
    // Every category counts at the normal taste.
    expect(asTech.breakdown.taste).toBe(0.7);
  });

  it("loses a tie with an earlier category, since new categories go last", () => {
    const base = makeEntry("aaaaaaaaaaaa", { category: "none", p: 1 }).category_probs;
    const tied = { ...base, none: 0, developer_tool_launches: 0.5, consumer_tech_releases: 0.5 };
    expect(topCategory(tied)).toBe("developer_tool_launches");
  });

  it("files a tech video in the tech section, not watch, while still scoring it by launch scale", () => {
    const item = makeItem({ source_type: "youtube" });
    const scored = scoreItem(makeEntry(item, { category: TECH, launchScale: 0.75 }), prefs, item);
    expect(scored.score).toBe(0.6716);
    const verdict = eligibility(scored);
    expect(verdict.eligible && verdict.candidate.home).toBe("tech");
  });
});
