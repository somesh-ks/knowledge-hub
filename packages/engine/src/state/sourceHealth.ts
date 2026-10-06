import type { Source, SourceHealthFile, SourcesFile } from "@dispatch/core";
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

/** Overlay stored health onto the registry. Sources with no record keep their configured values. */
export function overlayHealth(file: SourcesFile, health: SourceHealthFile): SourcesFile {
  const sources = file.sources.map((source): Source => {
    const entry = health.sources[source.id];
    if (!entry) return source;
    return {
      ...source,
      failures: entry.failures,
      ...(entry.last_ok ? { last_ok: entry.last_ok } : {}),
    };
  });
  return { ...file, sources };
}

/** Extract the health map to store. Only sources that have a counter or a last success. */
export function toHealthFile(file: SourcesFile): SourceHealthFile {
  const sources: SourceHealthFile["sources"] = {};
  for (const source of file.sources) {
    if (source.failures === 0 && !source.last_ok) continue;
    sources[source.id] = {
      failures: source.failures,
      ...(source.last_ok ? { last_ok: source.last_ok } : {}),
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
