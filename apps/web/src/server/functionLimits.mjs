/**
 * Time limits for the on-demand routes, kept in one file because they only make sense together.
 * astro.config.mjs passes FUNCTION_MAX_DURATION_S to the Vercel adapter, and /api/narrate reads the
 * rest. Plain JavaScript so the Astro config can import it.
 *
 * None of these are measured. They are the largest values that fit the 20 second limit the site
 * already had, and a digest of about 9,000 characters will not synthesize in 12 seconds. Before
 * narration goes live, time one on a preview deploy (the function logs "synthesis N ms") and raise
 * FUNCTION_MAX_DURATION_S and SYNTHESIS_DEADLINE_MS here together. functionLimits.test.ts fails when
 * the three numbers stop fitting.
 */

/**
 * Vercel stops a function after this many seconds. The adapter builds every on-demand route into one
 * function and has no per-route setting, so this covers /api/generate and /api/status too. It is a
 * ceiling, not a cost: those two still answer in a second or two.
 */
export const FUNCTION_MAX_DURATION_S = 20;

/**
 * The longest /api/narrate lets Speechify take. Past it the handler aborts the upstream request and
 * answers "took_too_long". The handler counts from the start of the request and never lets synthesis
 * run into NARRATE_OVERHEAD_MS, so a slow start shortens this; it is a ceiling, not a promise.
 */
export const SYNTHESIS_DEADLINE_MS = 12_000;

/**
 * Time kept back for everything around synthesis: the passphrase check, the Blob lookups, and the
 * uploads with their retries. Killed in the middle of an upload, the function would lose audio that
 * was already paid for. The handler enforces it: synthesis must end this long before the function's
 * limit, whatever SYNTHESIS_DEADLINE_MS says.
 */
export const NARRATE_OVERHEAD_MS = 8_000;

/**
 * The longest any one call to the Blob store may take. The Blob SDK retries by itself, up to ten
 * times, so without a limit of our own a single slow call could outlast the function.
 */
export const BLOB_CALL_TIMEOUT_MS = 3_000;

/**
 * The longest everything before synthesis may take together: finding out whether the audio exists,
 * reading the month's charges, taking the marker and writing the charge. Each of those calls has its
 * own limit, but several slow ones in a row must not use up the time synthesis needs.
 */
export const PRE_SYNTHESIS_BOUND_MS = 6_000;

/** An audio upload is larger than a lookup, so it gets longer, but never more than the time left. */
export const BLOB_UPLOAD_TIMEOUT_MS = 6_000;
