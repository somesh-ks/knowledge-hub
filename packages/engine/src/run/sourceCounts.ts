import type { JudgmentEntry } from "@dispatch/core";
import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import type { SourceCounts } from "../state/sourceStats.js";

const count = z.number().int().nonnegative();
/** `asked` and `flagged` are optional: a pass file written before they were counted still reads. */
const Counts = z.object({
  fetched: count,
  judged: count,
  passed: count,
  asked: count.optional(),
  flagged: count.optional(),
});

/** `.cache/run/<id>/source-counts.json`: per-source counters for one pass, applied at commit. */
export const SourceCountsFile = z.object({
  version: z.literal(1),
  sources: z.record(z.string(), Counts),
});
export type SourceCountsFile = z.infer<typeof SourceCountsFile>;

/** A judge's flag at or above these odds counts: the judge thinks it more likely than not. */
export const FLAG_ODDS = 0.5;

/**
 * True when the judge flagged an item as hype or sponsored. Funding is left out on purpose: it is
 * a subject, not a trust problem, and the venture category already weighs it.
 */
export function isFlagged(flags: Pick<JudgmentEntry["flags"], "hype" | "sponsored">): boolean {
  return flags.hype >= FLAG_ODDS || flags.sponsored >= FLAG_ODDS;
}

/**
 * Per-source counts of one pass: what each source fetched, what a judge answered, what of that the
 * judge asked the flag questions and flagged as hype or sponsored, and what cleared the bar.
 * `fetchedBySource` comes from the pool's fetch report and falls back to the items that reached the
 * pool when the report is missing. `asked` holds the flags of each judged item that was asked them;
 * a judged item without an entry, such as a topic-only one, was not asked.
 */
export function countSources(input: {
  fetchedBySource: Readonly<Record<string, number>> | undefined;
  poolSourceIds: ReadonlyMap<string, string>;
  judgedIds: readonly string[];
  asked: ReadonlyMap<string, Pick<JudgmentEntry["flags"], "hype" | "sponsored">>;
  passedIds: ReadonlySet<string>;
}): Record<string, Required<SourceCounts>> {
  const out: Record<string, Required<SourceCounts>> = {};
  const row = (id: string): Required<SourceCounts> => {
    out[id] ??= { fetched: 0, judged: 0, passed: 0, asked: 0, flagged: 0 };
    return out[id];
  };
  if (input.fetchedBySource) {
    for (const [id, n] of Object.entries(input.fetchedBySource)) row(id).fetched = n;
  } else {
    for (const sourceId of input.poolSourceIds.values()) row(sourceId).fetched += 1;
  }
  for (const itemId of input.judgedIds) {
    const sourceId = input.poolSourceIds.get(itemId);
    if (sourceId === undefined) continue;
    const counts = row(sourceId);
    counts.judged += 1;
    const flags = input.asked.get(itemId);
    if (flags === undefined) continue;
    counts.asked += 1;
    if (isFlagged(flags)) counts.flagged += 1;
  }
  for (const itemId of input.passedIds) {
    const sourceId = input.poolSourceIds.get(itemId);
    if (sourceId !== undefined) row(sourceId).passed += 1;
  }
  return out;
}

/** Null when the file is missing or unreadable: counters are a nicety, never a reason to fail a run. */
export async function readSourceCounts(path: string): Promise<Record<string, SourceCounts> | null> {
  try {
    const parsed = SourceCountsFile.safeParse(await readJsonIfExists(path, "source-counts.json"));
    return parsed.success ? parsed.data.sources : null;
  } catch {
    return null;
  }
}
