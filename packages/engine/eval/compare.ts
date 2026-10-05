import { CategoryOrNone, Item } from "@dispatch/core";
import { z } from "zod";
import { DEFAULT_SCORE_THRESHOLD, eligibility } from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";

/**
 * Pure comparison logic for the golden-set evaluation. Nothing here calls a model or reads a
 * file, so it is unit-tested offline; `run.ts` supplies the judgments and prints the results.
 */

export const GoldenEntry = Item.extend({
  expected: z.object({ keep: z.boolean(), category: CategoryOrNone }),
  /** Full source text, present for items the writer bake-off and grounding cases use. */
  source_text: z.string().optional(),
});
export type GoldenEntry = z.infer<typeof GoldenEntry>;

export const GroundingCase = z.object({
  id: z.string(),
  /** The golden item whose `source_text` the sentence is checked against. */
  item_id: z.string(),
  supported: z.boolean(),
  sentence: z.string(),
});
export type GroundingCase = z.infer<typeof GroundingCase>;

export function parseGolden(raw: unknown): GoldenEntry[] {
  return z.array(GoldenEntry).parse(raw);
}

export function parseGroundingCases(raw: unknown): GroundingCase[] {
  return z.array(GroundingCase).parse(raw);
}

/** Evenly spaced thresholds, rounded to avoid 0.15000000000000002. */
export function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let value = from; value <= to + 1e-9; value += step)
    out.push(Math.round(value * 1000) / 1000);
  return out;
}

export interface Confusion {
  /** Kept and should be kept. */
  tp: number;
  /** Kept but should be dropped. */
  fp: number;
  /** Dropped and should be dropped. */
  tn: number;
  /** Dropped but should be kept. */
  fn: number;
}

export interface Rates {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

export function ratesOf(c: Confusion): Rates {
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, c.tp + c.fn);
  return {
    accuracy: ratio(c.tp + c.tn, c.tp + c.fp + c.tn + c.fn),
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
  };
}

/** Which items the engine would keep at a threshold: eligible by category and score. */
export function keepDecisions(
  scored: readonly ScoredItem[],
  threshold: number,
): Map<string, boolean> {
  return new Map(scored.map((s) => [s.item.id, eligibility(s, threshold).eligible]));
}

export function confusionOf(
  decisions: ReadonlyMap<string, boolean>,
  golden: readonly GoldenEntry[],
): Confusion {
  const c: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const entry of golden) {
    const kept = decisions.get(entry.id);
    if (kept === undefined) continue;
    if (kept && entry.expected.keep) c.tp += 1;
    else if (kept) c.fp += 1;
    else if (entry.expected.keep) c.fn += 1;
    else c.tn += 1;
  }
  return c;
}

export interface KeepMistake {
  id: string;
  title: string;
  expected: boolean;
  actual: boolean;
  score: number;
}

export function keepMistakes(
  scored: readonly ScoredItem[],
  golden: readonly GoldenEntry[],
  threshold: number,
): KeepMistake[] {
  const byId = new Map(golden.map((g) => [g.id, g]));
  const mistakes: KeepMistake[] = [];
  for (const s of scored) {
    const entry = byId.get(s.item.id);
    if (!entry) continue;
    const actual = eligibility(s, threshold).eligible;
    if (actual !== entry.expected.keep) {
      mistakes.push({
        id: entry.id,
        title: entry.title,
        expected: entry.expected.keep,
        actual,
        score: s.score,
      });
    }
  }
  return mistakes;
}

export interface CategoryReport {
  total: number;
  correct: number;
  accuracy: number;
  wrong: Array<{ id: string; title: string; expected: CategoryOrNone; actual: CategoryOrNone }>;
}

export function categoryAccuracy(
  scored: readonly ScoredItem[],
  golden: readonly GoldenEntry[],
): CategoryReport {
  const byId = new Map(golden.map((g) => [g.id, g]));
  const wrong: CategoryReport["wrong"] = [];
  let total = 0;
  for (const s of scored) {
    const entry = byId.get(s.item.id);
    if (!entry) continue;
    total += 1;
    if (s.topCategory !== entry.expected.category) {
      wrong.push({
        id: entry.id,
        title: entry.title,
        expected: entry.expected.category,
        actual: s.topCategory,
      });
    }
  }
  return {
    total,
    correct: total - wrong.length,
    accuracy: ratio(total - wrong.length, total),
    wrong,
  };
}

export interface Agreement {
  /** Items both judges answered. */
  compared: number;
  category: number;
  keep: number;
}

/** How often two judges agree, on the top category and on the keep or drop decision. */
export function judgeAgreement(
  a: readonly ScoredItem[],
  b: readonly ScoredItem[],
  threshold: number = DEFAULT_SCORE_THRESHOLD,
): Agreement {
  const bById = new Map(b.map((s) => [s.item.id, s]));
  let compared = 0;
  let sameCategory = 0;
  let sameKeep = 0;
  for (const left of a) {
    const right = bById.get(left.item.id);
    if (!right) continue;
    compared += 1;
    if (left.topCategory === right.topCategory) sameCategory += 1;
    if (eligibility(left, threshold).eligible === eligibility(right, threshold).eligible)
      sameKeep += 1;
  }
  return { compared, category: ratio(sameCategory, compared), keep: ratio(sameKeep, compared) };
}

export interface SweepRow extends Rates {
  threshold: number;
  confusion: Confusion;
}

export const DEFAULT_SWEEP = range(0.2, 0.7, 0.05);

/** Keep or drop quality at each score threshold, for tuning DEFAULT_SCORE_THRESHOLD. */
export function thresholdSweep(
  scored: readonly ScoredItem[],
  golden: readonly GoldenEntry[],
  thresholds: readonly number[] = DEFAULT_SWEEP,
): SweepRow[] {
  return thresholds.map((threshold) => {
    const confusion = confusionOf(keepDecisions(scored, threshold), golden);
    return { threshold, confusion, ...ratesOf(confusion) };
  });
}

/** Highest F1; ties go to higher accuracy, then to the higher (stricter) threshold. */
export function bestSweepRow(rows: readonly SweepRow[]): SweepRow | undefined {
  return [...rows].sort(
    (x, y) => y.f1 - x.f1 || y.accuracy - x.accuracy || y.threshold - x.threshold,
  )[0];
}

export interface GroundingResult {
  id: string;
  supported: boolean;
  /** The Noul probability, or null when the check failed. */
  score: number | null;
}

export interface GroundingRow {
  threshold: number;
  accuracy: number;
  /** Unsupported sentences accepted. The costly error: a made-up claim reaches the digest. */
  falseAccept: number;
  /** Supported sentences rejected. Costs a rewrite or a dropped item. */
  falseReject: number;
  /** Checks that failed and so counted for neither side. */
  failed: number;
}

export const DEFAULT_GROUNDING_SWEEP = range(0.1, 0.95, 0.05);

export function groundingSweep(
  results: readonly GroundingResult[],
  thresholds: readonly number[] = DEFAULT_GROUNDING_SWEEP,
): GroundingRow[] {
  const scoredResults = results.filter(
    (r): r is GroundingResult & { score: number } => r.score !== null,
  );
  const failed = results.length - scoredResults.length;
  return thresholds.map((threshold) => {
    let falseAccept = 0;
    let falseReject = 0;
    for (const r of scoredResults) {
      const accepted = r.score >= threshold;
      if (accepted && !r.supported) falseAccept += 1;
      if (!accepted && r.supported) falseReject += 1;
    }
    return {
      threshold,
      falseAccept,
      falseReject,
      failed,
      accuracy: ratio(scoredResults.length - falseAccept - falseReject, scoredResults.length),
    };
  });
}

/** Lowest cost, where accepting an unsupported sentence costs twice a needless rejection. */
export function bestGroundingRow(rows: readonly GroundingRow[]): GroundingRow | undefined {
  const cost = (row: GroundingRow): number => 2 * row.falseAccept + row.falseReject;
  return [...rows].sort((x, y) => cost(x) - cost(y) || y.threshold - x.threshold)[0];
}

export interface VoiceSample {
  id: string;
  /** Rule names of each lint violation, across the item's three fields. */
  rules: string[];
  /** Fields checked for this item. */
  fields: number;
  /** Fields with at least one violation. */
  failingFields: number;
}

export interface VoiceReport {
  items: number;
  itemsClean: number;
  itemPassRate: number;
  fields: number;
  fieldsClean: number;
  fieldPassRate: number;
  byRule: Record<string, number>;
}

/** Voice-lint pass rate of written items, the writer bake-off's main quality number. */
export function voiceReport(samples: readonly VoiceSample[]): VoiceReport {
  const byRule: Record<string, number> = {};
  let fields = 0;
  let failingFields = 0;
  let itemsClean = 0;
  for (const sample of samples) {
    fields += sample.fields;
    failingFields += sample.failingFields;
    if (sample.rules.length === 0) itemsClean += 1;
    for (const rule of sample.rules) byRule[rule] = (byRule[rule] ?? 0) + 1;
  }
  return {
    items: samples.length,
    itemsClean,
    itemPassRate: ratio(itemsClean, samples.length),
    fields,
    fieldsClean: fields - failingFields,
    fieldPassRate: ratio(fields - failingFields, fields),
    byRule,
  };
}
