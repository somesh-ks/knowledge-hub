/**
 * What the sheets island and the island wake read of the run the indicator remembers
 * (scripts/runStatus.ts writes it and owns its shape). Kept apart so the island does not import the
 * indicator's script, and so the key and the fields read here have one home.
 */
export const RUN_STORAGE_KEY = "singularity:run";
/** Sent on the document each time the indicator redraws. */
export const RUN_EVENT = "singularity:run";
/** Sent on the document when a run is started on this page: the generations list shows it. */
export const GENERATION_STARTED_EVENT = "singularity:generation-started";
/** The last run whose end cue was played in this tab: `<id>:<phase>`. */
const CUED_KEY = "singularity:run-cued";

export interface RunRecord {
  id?: number;
  phase?: string;
  what?: string;
  /** A rewrite or a removal of an episode that exists; absent for a new episode. */
  kind?: string;
  /** The episode that rewrite or removal is about. */
  episode?: string;
  /** A finished briefing's page, `/d/<id>`. */
  href?: string;
  /** A finished run that published nothing: why. */
  outcome?: string;
  /** The workflow step a failed briefing stopped in. */
  step?: string;
  /** When the run last changed phase (`Date.now()`). */
  stageAt?: number;
  /** Where the status route said the run is: the stage, how many there are, and its name. */
  stage?: number;
  stages?: number;
  label?: string;
  /** When it was started, and the usual length of each of its stages (the status route's estimates). */
  t0?: number;
  estimates?: (number | null)[];
  /** The request that started it, kept for Try again: an episode's `request`, or a Regenerate's `replace`. */
  retry?: { body: Record<string, unknown> };
}

/**
 * A storage, or a function that gets it. Resolving `localStorage` itself throws when the browser
 * blocks site data, so a caller passes `() => localStorage` and the throw lands in the try below.
 */
type StorageSource<T> = T | (() => T);

function resolve<T>(source: StorageSource<T>): T {
  return typeof source === "function" ? (source as () => T)() : source;
}

/**
 * Read the indicator's stored JSON object without validating its fields. Missing, unreadable or
 * malformed data returns null; a storage getter may be supplied so blocked access is caught too.
 */
export function readRunRecord(storage: StorageSource<Pick<Storage, "getItem">>): RunRecord | null {
  try {
    const run: unknown = JSON.parse(resolve(storage).getItem(RUN_STORAGE_KEY) ?? "null");
    return typeof run === "object" && run !== null ? (run as RunRecord) : null;
  } catch {
    return null;
  }
}

/** A run that is still going: the sheets island is woken early to say how it ends (a toast, and a cue for a podcast). */
export const isRunGoing = (run: RunRecord | null): boolean =>
  run !== null &&
  run.kind !== "delete" &&
  (run.phase === "queued" || run.phase === "running" || run.phase === "updating");

/**
 * How a run's end is told, once: a toast for every run (the queue lets go of a run that finished, so
 * the toast is how it is found), and a sound for a podcast. The indicator redraws many times after a
 * run ends (a tap on a row, another page), and the island is mounted anew on each page, so the answer
 * is kept for the tab: the last claimed `<id>:<phase>` is suppressed on later calls. Other runs or
 * phases replace that claim. If storage is unavailable, the end is returned and may repeat.
 */
export function claimEnd(
  run: RunRecord | null,
  session: StorageSource<Pick<Storage, "getItem" | "setItem">>,
): { ended: "finished" | "failed"; sound: boolean } | null {
  if (!run || (run.phase !== "done" && run.phase !== "failed")) return null;
  const key = `${run.id}:${run.phase}`;
  try {
    const storage = resolve(session);
    if (storage.getItem(CUED_KEY) === key) return null;
    storage.setItem(CUED_KEY, key);
  } catch {
    // Without storage the end may be told twice; it is a toast and a sound, not a record.
  }
  return { ended: run.phase === "done" ? "finished" : "failed", sound: run.what === "briefing" };
}

/** How long after a run's end the island, mounting late, still announces it. */
const LATE_MOUNT_MS = 30_000;

/**
 * Whether a run ended just now, in the gap before the island was listening. The sheets island wakes
 * after the first status answer can arrive, and the event that answer sent reached nobody; looking
 * once at mount makes up for it. A run that ended before the page opened has its card and is not
 * announced again. `now`, `since` and `stageAt` are epoch milliseconds; the end must be at or
 * after `since`, no later than `now`, and less than 30 seconds old. This does not claim a cue.
 */
export function endedRecently(
  run: RunRecord | null,
  now = Date.now(),
  /** When this page began: a tab opened after the run ended has no cue claim and must not play it. */
  since = performance.timeOrigin,
): boolean {
  return (
    run?.stageAt !== undefined &&
    (run.phase === "done" || run.phase === "failed") &&
    run.stageAt >= since &&
    now - run.stageAt >= 0 &&
    now - run.stageAt < LATE_MOUNT_MS
  );
}
