import type { Source, SourcesFile } from "@dispatch/core";
import type { SourceResult } from "../fetch/types.js";

/** A source failing this many runs in a row is flagged (build plan risk table). */
export const FAILURE_FLAG_THRESHOLD = 5;

/**
 * Update failure counters and last_ok from a fetch pass. Success resets the counter. A skipped
 * source (missing key) succeeded at nothing and failed at nothing, so it is left alone; so is a
 * source that was not part of this pass.
 */
export function applySourceResults(
  file: SourcesFile,
  results: readonly SourceResult[],
  now: Date,
): SourcesFile {
  const byId = new Map(results.map((result) => [result.source_id, result]));
  const sources = file.sources.map((source): Source => {
    const result = byId.get(source.id);
    if (!result) return source;
    if (result.ok && result.note !== undefined) return source;
    if (result.ok) return { ...source, failures: 0, last_ok: now.toISOString() };
    return { ...source, failures: source.failures + 1 };
  });
  return { ...file, sources };
}

export function failingSources(
  file: SourcesFile,
  threshold: number = FAILURE_FLAG_THRESHOLD,
): Source[] {
  return file.sources.filter((source) => source.enabled && source.failures >= threshold);
}
