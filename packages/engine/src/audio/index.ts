/**
 * `@singularity/engine/audio`: the narration code that runs anywhere. The site's /api/narrate function
 * imports this entry, so everything reachable from it must stay free of the file system, of git and
 * of the run pipeline. Storage belongs to the caller: the engine and the function keep one count in
 * Blob (usageBlob.ts, D339).
 *
 * test/audio-entry.test.ts walks the imports from here and fails when that stops being true.
 */
export * from "./budgetMath.js";
export * from "./speechify.js";
export * from "./spokenSegments.js";
export * from "./spokenText.js";
export * from "./sse.js";
export * from "./timeline.js";
