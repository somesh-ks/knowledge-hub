import type { Source, SourceHealthFile, SourcesFile } from "@singularity/core";
import type { SourceResult } from "../fetch/types.js";
import { FAILURE_FLAG_THRESHOLD } from "../ops/healthLimits.js";

export { FAILURE_FLAG_THRESHOLD };

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
    const tried = now.toISOString();
    if (result.ok) return { ...source, failures: 0, last_ok: tried, last_try: tried };
    return { ...source, failures: source.failures + 1, last_try: tried };
  });
  return { ...file, sources };
}

/** Overlay stored health onto the registry. Sources with no record keep their configured values. */
export function overlayHealth(file: SourcesFile, health: SourceHealthFile): SourcesFile {
  const sources = file.sources.map((source): Source => {
    const entry = health.sources[source.id];
    if (!entry) return source;
    return {
      ...source,
      failures: entry.failures,
      ...(entry.last_ok ? { last_ok: entry.last_ok } : {}),
      ...(entry.last_try ? { last_try: entry.last_try } : {}),
    };
  });
  return { ...file, sources };
}

/** Extract the health map to store. Only sources that have a counter or a last success. */
export function toHealthFile(file: SourcesFile): SourceHealthFile {
  const sources: SourceHealthFile["sources"] = {};
  for (const source of file.sources) {
    if (source.failures === 0 && !source.last_ok && !source.last_try) continue;
    sources[source.id] = {
      failures: source.failures,
      ...(source.last_ok ? { last_ok: source.last_ok } : {}),
      ...(source.last_try ? { last_try: source.last_try } : {}),
    };
  }
  return { version: 1, sources };
}

export function failingSources(
  file: SourcesFile,
  threshold: number = FAILURE_FLAG_THRESHOLD,
): Source[] {
  return file.sources.filter((source) => source.enabled && source.failures >= threshold);
}
