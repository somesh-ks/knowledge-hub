/**
 * The lines `singularity health` judges by, in one module with no imports, so the site's Health page
 * (apps/web/src/server/health.ts) reads the same numbers without loading the engine. Change a line
 * here and the daily check and the page move together.
 */

/** A briefing with fewer stories than this is thin (the schema stops at 3): the run found little or dropped most. */
export const THIN_DIGEST_ITEMS = 5;
/**
 * Shares of its set length below which an episode is short: a warning under 90%, a fault (the
 * `health` issue) under 75%. Every daily from 2026-10-11 to 10-17 aired 2.9 to 3.8 of its 5
 * minutes and the 10-18 weekly 5 of its 15, and nothing said so for a week.
 */
export const SHORT_EPISODE_WARN = 0.9;
export const SHORT_EPISODE_FAULT = 0.75;
/** How long past its commit time a due briefing may stay unpublished before health says so. */
export const SLOT_MISSED_AFTER_MS = 15 * 60_000;
/** A p75 of fewer samples than this says more about one visit than about the site. */
export const FIELD_MIN_SAMPLES = 20;
/** Script blocks in 24 hours from this many reports on are a warning: an extension's one is not. */
export const SCRIPT_BLOCKS_PER_DAY = 3;
/** Client errors on one route in 24 hours from this many on are a warning (opaque ones not counted). */
export const CLIENT_ERRORS_PER_DAY = 20;
/** Server errors (a 5xx a site function answered) on one route in 24 hours from this many on warn. */
export const SERVER_FAULTS_PER_DAY = 3;
/** Functions Vercel killed (a timeout, a crash) on one route in 24 hours from this many on warn. */
export const PLATFORM_FAULTS_PER_DAY = 3;
/** CSP directives whose violation means a script did not run: a feature broken, or an injection. */
export const SCRIPT_DIRECTIVES: ReadonlySet<string> = new Set(["script-src", "script-src-elem"]);
/** A source failing this many runs in a row is flagged (build plan risk table). */
export const FAILURE_FLAG_THRESHOLD = 5;
