import { describe, expect, it } from "vitest";
import {
  BONUS,
  CRAFT_FLOOR,
  craftFactor,
  penaltyFactor,
  preferenceBonus,
  scoreItem,
  taste,
  topCategory,
} from "../src/score/scoreItem.js";
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
  it("sums probability times weight and ignores the none option", () => {
    const entry = makeEntry("aaaaaaaaaaaa", { category: "design_engineering_craft", p: 0.5 });
    expect(taste(entry.category_probs, prefs.weights)).toBeCloseTo(0.475, 6);
  });

  it("weights a split distribution across categories", () => {
    const entry = makeEntry("aaaaaaaaaaaa", { category: "design_engineering_craft", p: 0.6 });
    const probs = { ...entry.category_probs, none: 0, frontier_model_releases: 0.4 };
    expect(taste(probs, prefs.weights)).toBeCloseTo(0.6 * 0.95 + 0.4 * 0.85, 6);
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
    expect(result.score).toBe(0.95);
    expect(result.topCategory).toBe("design_engineering_craft");
    expect(result.breakdown).toEqual({ taste: 0.95, craftFactor: 1, penaltyFactor: 1, bonus: 0 });
  });

  it("lowers the score for an announcement with no technique", () => {
    const item = makeItem();
    const deep = scoreItem(makeEntry(item, { depth: 1 }), prefs, item).score;
    const shallow = scoreItem(makeEntry(item, { depth: 0 }), prefs, item).score;
    expect(shallow).toBeCloseTo(0.95 * CRAFT_FLOOR, 3);
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

  it("puts venture and hype categories far below the bar", () => {
    const item = makeItem();
    expect(
      scoreItem(makeEntry(item, { category: "venture_capital_and_gossip" }), prefs, item).score,
    ).toBe(0.1);
    expect(
      scoreItem(makeEntry(item, { category: "generic_ai_hype_listicles" }), prefs, item).score,
    ).toBe(0.02);
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
    expect(result.score).toBeCloseTo(1, 6);
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

  it("rounds scores to four decimals", () => {
    const item = makeItem();
    const { score } = scoreItem(makeEntry(item, { depth: 0.37, p: 0.83, hype: 0.11 }), prefs, item);
    expect(score).toBe(Math.round(score * 10_000) / 10_000);
  });
});
