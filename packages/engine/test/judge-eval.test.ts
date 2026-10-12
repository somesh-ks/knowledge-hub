import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CategoryOrNone } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import {
  categoryAccuracy,
  confusionOf,
  type GoldenEntry,
  keepDecisions,
  keepMistakes,
  parseGolden,
  parseGroundingCases,
  ratesOf,
} from "../eval/compare.js";
import { scoreItem } from "../src/score/scoreItem.js";
import { DEFAULT_SCORE_THRESHOLD } from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";
import { makeEntry, plainPreferences, REPO_ROOT } from "./score-factories.js";

const evalDir = join(REPO_ROOT, "packages", "engine", "eval", "golden");
const golden = parseGolden(JSON.parse(readFileSync(join(evalDir, "pool.json"), "utf8")));
const _groundingCases = parseGroundingCases(
  JSON.parse(readFileSync(join(evalDir, "grounding.json"), "utf8")),
);

describe("the golden set", () => {
  it("rejects malformed golden files", () => {
    expect(() => parseGolden([{ nope: true }])).toThrow();
    expect(() => parseGroundingCases([{ id: "x" }])).toThrow();
  });
});

/**
 * A judge that always answers what the golden set expects, with plausible depth. For a launch it
 * answers level 3 when the item should publish and level 0 (rumour, deal, accessory) when not,
 * which is the distinction the launch-scale question exists to draw.
 */
function oracleScored(
  entries: readonly GoldenEntry[],
  overrides: Partial<Record<string, CategoryOrNone>> = {},
): ScoredItem[] {
  const prefs = plainPreferences();
  return entries.map((g) => {
    const category = overrides[g.id] ?? g.expected.category;
    const entry = makeEntry(g.id, {
      category,
      p: 0.9,
      depth: g.expected.keep ? 0.6 : 0.2,
      launchScale: g.expected.keep ? 0.75 : 0,
    });
    return scoreItem(entry, prefs, g);
  });
}

describe("scoring against the golden set", () => {
  it("keeps and drops every item correctly when the judge names the expected category", () => {
    const scored = oracleScored(golden);
    const confusion = confusionOf(keepDecisions(scored, DEFAULT_SCORE_THRESHOLD), golden);
    expect(confusion.fp + confusion.fn).toBe(0);
    expect(keepMistakes(scored, golden, DEFAULT_SCORE_THRESHOLD)).toEqual([]);
  });

  it("decides the tech items on launch scale alone: the category is the same for all six", () => {
    const tech = golden.filter((g) => g.expected.category === "consumer_tech_releases");
    const scores = new Map(oracleScored(tech).map((s) => [s.item.id, s.score]));
    for (const g of tech) {
      // 0.9 x 0.8 x the launch factor: 0.6908 at level 3 and 0.252 at level 0.
      expect(scores.get(g.id), g.title).toBe(g.expected.keep ? 0.6908 : 0.252);
    }
    expect(keepMistakes(oracleScored(tech), tech, DEFAULT_SCORE_THRESHOLD)).toEqual([]);
  });

  it("reports a miss when the judge mislabels a kept item as hype", () => {
    const victim = golden.find((g) => g.expected.keep) as GoldenEntry;
    const scored = oracleScored(golden, { [victim.id]: "generic_ai_hype_listicles" });
    const mistakes = keepMistakes(scored, golden, DEFAULT_SCORE_THRESHOLD);
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0]).toMatchObject({ id: victim.id, expected: true, actual: false });
    expect(categoryAccuracy(scored, golden).wrong[0]).toMatchObject({
      id: victim.id,
      actual: "generic_ai_hype_listicles",
    });
  });
});

describe("comparison math", () => {
  it("computes accuracy, precision, recall and F1", () => {
    const rates = ratesOf({ tp: 6, fp: 2, tn: 8, fn: 4 });
    expect(rates.accuracy).toBeCloseTo(14 / 20, 6);
    expect(rates.precision).toBeCloseTo(0.75, 6);
    expect(rates.recall).toBeCloseTo(0.6, 6);
    expect(rates.f1).toBeCloseTo((2 * 0.75 * 0.6) / 1.35, 6);
  });

  it("returns zeros instead of NaN for empty denominators", () => {
    expect(ratesOf({ tp: 0, fp: 0, tn: 0, fn: 0 })).toEqual({
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1: 0,
    });
  });
});
