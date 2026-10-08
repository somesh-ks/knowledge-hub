import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import type { SourceCounts } from "../state/sourceStats.js";

const count = z.number().int().nonnegative();
const Counts = z.object({ fetched: count, judged: count, passed: count });

/** `.cache/run/<id>/source-counts.json`: per-source counters for one pass, applied at commit. */
export const SourceCountsFile = z.object({
  version: z.literal(1),
  sources: z.record(z.string(), Counts),
});
export type SourceCountsFile = z.infer<typeof SourceCountsFile>;

/**
 * Per-source counts of one pass: what each source fetched, what a judge answered and what cleared
 * the bar. `fetchedBySource` comes from the pool's fetch report and falls back to the items that
 * reached the pool when the report is missing.
 */
export function countSources(input: {
  fetchedBySource: Readonly<Record<string, number>> | undefined;
  poolSourceIds: ReadonlyMap<string, string>;
  judgedIds: readonly string[];
  passedIds: ReadonlySet<string>;
}): Record<string, SourceCounts> {
  const out: Record<string, SourceCounts> = {};
  const row = (id: string): SourceCounts => {
    out[id] ??= { fetched: 0, judged: 0, passed: 0 };
    return out[id];
  };
  if (input.fetchedBySource) {
    for (const [id, n] of Object.entries(input.fetchedBySource)) row(id).fetched = n;
  } else {
    for (const sourceId of input.poolSourceIds.values()) row(sourceId).fetched += 1;
  }
  for (const itemId of input.judgedIds) {
    const sourceId = input.poolSourceIds.get(itemId);
    if (sourceId !== undefined) row(sourceId).judged += 1;
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
