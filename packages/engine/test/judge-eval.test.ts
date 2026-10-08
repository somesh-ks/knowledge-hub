import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES, type CategoryOrNone, itemId, NEVER_PUBLISH } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import {
  bestGroundingRow,
  bestSweepRow,
  categoryAccuracy,
  confusionOf,
  type GoldenEntry,
  groundingSweep,
  judgeAgreement,
  keepDecisions,
  keepMistakes,
  parseGolden,
  parseGroundingCases,
  range,
  ratesOf,
  thresholdSweep,
  voiceReport,
} from "../eval/compare.js";
import { bakeoffTable, groundingTable, percent, sweepTable, topRules } from "../eval/report.js";
import { scoreItem } from "../src/score/scoreItem.js";
import { DEFAULT_SCORE_THRESHOLD } from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";
import { makeEntry, plainPreferences, REPO_ROOT } from "./score-factories.js";

const evalDir = join(REPO_ROOT, "packages", "engine", "eval", "golden");
const golden = parseGolden(JSON.parse(readFileSync(join(evalDir, "pool.json"), "utf8")));
const groundingCases = parseGroundingCases(
  JSON.parse(readFileSync(join(evalDir, "grounding.json"), "utf8")),
);

describe("the golden set", () => {
  it("holds 36 valid items with unique ids derived from their URLs", () => {
    expect(golden).toHaveLength(36);
    expect(new Set(golden.map((g) => g.id)).size).toBe(golden.length);
    for (const g of golden) expect(g.id).toBe(itemId(g.canonical_url));
  });

  it("balances keep and drop and covers every category the user cares about", () => {
    const keep = golden.filter((g) => g.expected.keep);
    expect(keep.length).toBeGreaterThanOrEqual(12);
    expect(golden.length - keep.length).toBeGreaterThanOrEqual(12);
    const kept = new Set(keep.map((g) => g.expected.category));
    const publishable = CATEGORIES.filter((category) => !NEVER_PUBLISH.includes(category));
    expect(publishable).toHaveLength(9);
    expect(publishable).toContain("consumer_tech_releases");
    for (const category of publishable) expect(kept.has(category), category).toBe(true);
    for (const category of NEVER_PUBLISH) expect(kept.has(category), category).toBe(false);
    const dropped = new Set(golden.filter((g) => !g.expected.keep).map((g) => g.expected.category));
    expect(dropped.has("venture_capital_and_gossip")).toBe(true);
    expect(dropped.has("generic_ai_hype_listicles")).toBe(true);
    expect(dropped.has("none")).toBe(true);
  });

  it("holds six consumer tech items: three launches to publish and three to drop", () => {
    const tech = golden.filter((g) => g.expected.category === "consumer_tech_releases");
    expect(tech).toHaveLength(6);
    const titles = (keep: boolean): string =>
      tech
        .filter((g) => g.expected.keep === keep)
        .map((g) => g.title)
        .join("\n");
    expect(tech.filter((g) => g.expected.keep)).toHaveLength(3);
    // A flagship phone, a major OS release and a regulation that changes devices.
    expect(titles(true)).toMatch(/Orbit 12 launches/);
    expect(titles(true)).toMatch(/Meridian OS 9 is out/);
    expect(titles(true)).toMatch(/EU rule requiring user-replaceable phone batteries/);
    // A rumour, a discount deal and a case accessory.
    expect(titles(false)).toMatch(/Rumour/);
    expect(titles(false)).toMatch(/record low/);
    expect(titles(false)).toMatch(/clear case/);
  });

  it("never expects a never-publish or unplaceable item to be kept", () => {
    for (const g of golden.filter((x) => x.expected.keep)) {
      expect(["venture_capital_and_gossip", "generic_ai_hype_listicles", "none"]).not.toContain(
        g.expected.category,
      );
    }
  });

  it("includes video, hype, sponsored and funding cases and a source text with an injected instruction", () => {
    expect(golden.some((g) => g.source_type === "youtube")).toBe(true);
    expect(golden.some((g) => /sponsored/i.test(g.title))).toBe(true);
    expect(golden.some((g) => /raises|funding/i.test(g.title))).toBe(true);
    expect(golden.some((g) => /ignore all previous instructions/i.test(g.source_text ?? ""))).toBe(
      true,
    );
  });

  it("has source texts for the items the bake-off writes", () => {
    expect(golden.filter((g) => g.expected.keep && g.source_text).length).toBeGreaterThanOrEqual(8);
  });

  it("has grounding cases that point at golden items with source text, split between true and false", () => {
    const withText = new Map(golden.filter((g) => g.source_text).map((g) => [g.id, g]));
    for (const c of groundingCases) expect(withText.has(c.item_id)).toBe(true);
    const supported = groundingCases.filter((c) => c.supported).length;
    expect(groundingCases.length).toBeGreaterThanOrEqual(20);
    expect(supported).toBeGreaterThanOrEqual(8);
    expect(groundingCases.length - supported).toBeGreaterThanOrEqual(8);
  });

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
  it("builds evenly spaced thresholds without float noise", () => {
    expect(range(0.1, 0.3, 0.05)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3]);
  });

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

  it("counts a confusion matrix only over items that have a decision", () => {
    const [a, b, c] = golden as [GoldenEntry, GoldenEntry, GoldenEntry];
    const decisions = new Map([
      [a.id, a.expected.keep],
      [b.id, !b.expected.keep],
    ]);
    const matrix = confusionOf(decisions, [a, b, c]);
    expect(matrix.tp + matrix.fp + matrix.tn + matrix.fn).toBe(2);
    expect(matrix.fp + matrix.fn).toBe(1);
  });

  it("measures agreement between two judges on category and keep or drop", () => {
    const base = oracleScored(golden.slice(0, 10));
    const flipped = oracleScored(golden.slice(0, 10), { [golden[0]?.id as string]: "none" });
    const same = judgeAgreement(base, base);
    expect(same).toEqual({ compared: 10, category: 1, keep: 1 });
    const different = judgeAgreement(base, flipped);
    expect(different.category).toBeCloseTo(0.9, 6);
    expect(different.keep).toBeCloseTo(0.9, 6);
  });

  it("compares only the items both judges answered", () => {
    const agreement = judgeAgreement(
      oracleScored(golden.slice(0, 6)),
      oracleScored(golden.slice(3, 9)),
    );
    expect(agreement.compared).toBe(3);
  });

  it("sweeps thresholds and picks the best F1, preferring accuracy then the stricter threshold", () => {
    const scored = oracleScored(golden);
    const rows = thresholdSweep(scored, golden, [0.1, 0.4, 0.99]);
    expect(rows.map((r) => r.threshold)).toEqual([0.1, 0.4, 0.99]);
    expect(rows[1]?.f1).toBe(1);
    expect(rows[2]?.recall).toBe(0);
    expect(bestSweepRow(rows)?.threshold).toBe(0.4);
    const tied = [
      {
        threshold: 0.3,
        f1: 0.9,
        accuracy: 0.9,
        precision: 1,
        recall: 1,
        confusion: { tp: 0, fp: 0, tn: 0, fn: 0 },
      },
      {
        threshold: 0.5,
        f1: 0.9,
        accuracy: 0.9,
        precision: 1,
        recall: 1,
        confusion: { tp: 0, fp: 0, tn: 0, fn: 0 },
      },
    ];
    expect(bestSweepRow(tied)?.threshold).toBe(0.5);
    expect(bestSweepRow([])).toBeUndefined();
  });

  it("sweeps the grounding threshold and counts false accepts, false rejects and failed checks", () => {
    const results = [
      { id: "a", supported: true, score: 0.9 },
      { id: "b", supported: true, score: 0.45 },
      { id: "c", supported: false, score: 0.55 },
      { id: "d", supported: false, score: 0.1 },
      { id: "e", supported: true, score: null },
    ];
    const rows = groundingSweep(results, [0.3, 0.5, 0.7]);
    expect(rows[0]).toMatchObject({ threshold: 0.3, falseAccept: 1, falseReject: 0, failed: 1 });
    expect(rows[1]).toMatchObject({ falseAccept: 1, falseReject: 1 });
    expect(rows[2]).toMatchObject({ falseAccept: 0, falseReject: 1 });
    expect(rows[2]?.accuracy).toBeCloseTo(0.75, 6);
  });

  it("weights a false accept twice a false reject when choosing the grounding threshold", () => {
    const rows = [
      { threshold: 0.3, accuracy: 0.8, falseAccept: 2, falseReject: 0, failed: 0 },
      { threshold: 0.6, accuracy: 0.8, falseAccept: 0, falseReject: 3, failed: 0 },
      { threshold: 0.8, accuracy: 0.7, falseAccept: 0, falseReject: 3, failed: 0 },
    ];
    expect(bestGroundingRow(rows)?.threshold).toBe(0.8);
    expect(bestGroundingRow([])).toBeUndefined();
  });

  it("summarizes the voice-lint pass rate of written items", () => {
    const report = voiceReport([
      { id: "a", rules: [], fields: 3, failingFields: 0 },
      { id: "b", rules: ["banned_word", "exclamation"], fields: 3, failingFields: 1 },
      { id: "c", rules: ["banned_word"], fields: 3, failingFields: 1 },
      { id: "d", rules: [], fields: 3, failingFields: 0 },
    ]);
    expect(report).toMatchObject({
      items: 4,
      itemsClean: 2,
      itemPassRate: 0.5,
      fields: 12,
      fieldsClean: 10,
    });
    expect(report.fieldPassRate).toBeCloseTo(10 / 12, 6);
    expect(report.byRule).toEqual({ banned_word: 2, exclamation: 1 });
    expect(voiceReport([]).itemPassRate).toBe(0);
  });
});

describe("report formatting", () => {
  it("formats percentages", () => {
    expect(percent(0.8333)).toBe("83.3%");
  });

  it("marks the best row in the sweep tables", () => {
    const rows = thresholdSweep(oracleScored(golden), golden, [0.3, 0.4]);
    const text = sweepTable(rows, bestSweepRow(rows));
    expect(text.split("\n")[0]).toContain("threshold");
    expect(text).toMatch(/0\.40 \*/);
    expect(text).not.toMatch(/0\.30 \*/);
    const grounding = groundingTable(
      groundingSweep([{ id: "a", supported: true, score: 0.9 }], [0.5]),
    );
    expect(grounding).toContain("false accepts");
  });

  it("formats the bake-off with n/a when no grounder ran", () => {
    const report = voiceReport([{ id: "a", rules: ["banned_word"], fields: 3, failingFields: 1 }]);
    const text = bakeoffTable([
      {
        model: "m1",
        jsonFailures: 0,
        written: 1,
        firstPass: report,
        afterRewrite: voiceReport([{ id: "a", rules: [], fields: 3, failingFields: 0 }]),
        grounded: null,
        tokens: 1234,
      },
    ]);
    expect(text).toContain("m1");
    expect(text).toContain("n/a");
    expect(text).toContain("100.0%");
    expect(topRules(report)).toBe("banned_word x1");
    expect(topRules(voiceReport([]))).toBe("none");
  });
});
