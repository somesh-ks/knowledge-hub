import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../state/atomicWrite.js";

/**
 * The health of the generation, measured per run and kept in `state/run-metrics.json` (one entry per
 * briefing pass, the newest 60). Written in the run's own commit through the write guard, so the
 * numbers cost no extra push. `docs/engineering/metrics.md` lists every metric, its target and why.
 */
export const RUN_METRICS_PATH = "state/run-metrics.json";
/** About two months of daily and weekly briefings plus a few regenerations. */
export const RUN_METRICS_KEEP = 60;

const count = z.number().int().nonnegative();
const ms = z.number().nonnegative();

export const RunMetric = z.object({
  /** The plan's `created_at`: the run, shared by its passes. */
  run_id: z.string().min(1),
  /** When the run's commit stage ran. */
  at: z.string().datetime({ offset: true }),
  digest_id: z.string().min(1),
  /** `regular` or `weekly`: what the pass made. */
  kind: z.string(),
  /** How the run began: the schedule, a Regenerate or Generate press, a weekly. */
  mode: z.string(),
  /** True when the run replaced a briefing (a Regenerate). */
  replace: z.boolean(),
  outcome: z.enum(["published", "nothing", "failed"]),
  /** Wall time per stage in milliseconds; a stage that did not run has none. */
  stage_ms: z.record(z.string(), ms),
  /** Plan created to commit, in milliseconds, holding for the publish time excluded. */
  total_ms: ms.optional(),
  funnel: z.object({
    /** Stories in the pass's pool after the prefilter. */
    pool: count,
    /** Stories the write stage chose and wrote (spares included). */
    written: count,
    /** Stories grounding dropped (unsupported, or a voice rule its rewrite broke). */
    grounding_dropped: count,
    /** Stories kept after unsupported sentences were cut out. */
    grounding_pruned: count,
    /** Stories validation dropped, or trimmed for a section's allowance. */
    validate_dropped: count,
    /** Stories the refill wrote and kept. */
    refill_written: count,
    refill_kept: count,
    /** Stories the briefing airs. */
    aired: count,
  }),
  length: z.object({
    /** The owner's length in narration characters; null for a briefing with no set length. */
    asked_chars: count.nullable(),
    aired_chars: count.nullable(),
    /** aired / asked, 0 to about 1.3; null when either is unknown. */
    share: z.number().nonnegative().nullable(),
  }),
  verified: z.boolean(),
  /** A model that failed and was replaced by the next in its chain, over the run. */
  model_fallbacks: count,
  /** Set for a failed run: the stage that stopped it and why, in a sentence. */
  failure: z.object({ stage: z.string(), reason: z.string().max(300) }).optional(),
});
export type RunMetric = z.infer<typeof RunMetric>;

export const RunMetricsFile = z.object({
  version: z.literal(1),
  runs: z.array(RunMetric),
});
export type RunMetricsFile = z.infer<typeof RunMetricsFile>;

/**
 * The entries of a run-metrics document that parse, or null when it is not one. An entry that no
 * longer parses (a field the schema grew) is left out and the others stay: one old entry must not
 * empty the file, nor stop two runs' files from merging.
 */
export function parseRunMetrics(value: unknown): RunMetricsFile | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, runs } = value as { version?: unknown; runs?: unknown };
  if (version !== 1 || !Array.isArray(runs)) return null;
  return {
    version: 1,
    runs: runs.flatMap((run) => {
      const entry = RunMetric.safeParse(run);
      return entry.success ? [entry.data] : [];
    }),
  };
}

export async function readRunMetrics(root: string): Promise<RunMetricsFile> {
  try {
    const parsed = parseRunMetrics(
      JSON.parse(await readFile(join(root, RUN_METRICS_PATH), "utf8")),
    );
    return parsed ?? { version: 1, runs: [] };
  } catch {
    return { version: 1, runs: [] };
  }
}

/** Add entries to the file, one per pass of a run, the oldest beyond the newest 60 dropped. */
export async function recordRunMetrics(root: string, entries: readonly RunMetric[]): Promise<void> {
  if (entries.length === 0) return;
  const file = await readRunMetrics(root);
  const key = (entry: RunMetric): string => `${entry.run_id}|${entry.digest_id}`;
  const byKey = new Map(file.runs.map((entry) => [key(entry), entry]));
  for (const entry of entries) byKey.set(key(entry), entry);
  const runs = [...byKey.values()]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-RUN_METRICS_KEEP);
  await writeFileAtomic(
    join(root, RUN_METRICS_PATH),
    `${JSON.stringify({ version: 1, runs }, null, 2)}\n`,
  );
}
