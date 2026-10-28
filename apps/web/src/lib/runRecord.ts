/**
 * What the sheets island and the island wake read of the run the indicator remembers
 * (scripts/runStatus.ts writes it and owns its shape). Kept apart so the island does not import the
 * indicator's script, and so the key and the fields read here have one home.
 */
export const RUN_STORAGE_KEY = "singularity:run";
/** Sent on the document each time the indicator redraws. */
export const RUN_EVENT = "singularity:run";
/** The last run whose end cue was played in this tab: `<id>:<phase>`. */
const CUED_KEY = "singularity:run-cued";

export interface RunRecord {
  id?: number;
  phase?: string;
  what?: string;
  /** A finished briefing's page, `/d/<id>`. */
  href?: string;
  /** A finished run that published nothing: why. */
  outcome?: string;
  /** The workflow step a failed briefing stopped in. */
  step?: string;
  /** When the run last changed phase (`Date.now()`). */
  stageAt?: number;
}

/**
 * A storage, or a function that gets it. Resolving `localStorage` itself throws when the browser
 * blocks site data, so a caller passes `() => localStorage` and the throw lands in the try below.
 */
type StorageSource<T> = T | (() => T);

function resolve<T>(source: StorageSource<T>): T {
  return typeof source === "function" ? (source as () => T)() : source;
}

export function readRunRecord(storage: StorageSource<Pick<Storage, "getItem">>): RunRecord | null {
  try {
    const run: unknown = JSON.parse(resolve(storage).getItem(RUN_STORAGE_KEY) ?? "null");
    return typeof run === "object" && run !== null ? (run as RunRecord) : null;
  } catch {
    return null;
  }
}

/** A briefing run that is still going: the sheets island is woken early to play its end cue. */
export const isBriefingGoing = (run: RunRecord | null): boolean =>
  run?.what === "briefing" && (run.phase === "queued" || run.phase === "running");

/**
 * The cue a briefing run's end is owed, once. The indicator redraws many times after a run ends (a
 * tap on its chevron, another page), and the island is mounted anew on each page, so the answer is
 * kept for the tab: a run's end plays its cue the first time it is asked, and never again.
 */
export function claimEndCue(
  run: RunRecord | null,
  session: StorageSource<Pick<Storage, "getItem" | "setItem">>,
): "finished" | "failed" | null {
  if (run?.what !== "briefing" || (run.phase !== "done" && run.phase !== "failed")) return null;
  const key = `${run.id}:${run.phase}`;
  try {
    const storage = resolve(session);
    if (storage.getItem(CUED_KEY) === key) return null;
    storage.setItem(CUED_KEY, key);
  } catch {
    // Without storage the cue may repeat; it is a sound, not a record.
  }
  return run.phase === "done" ? "finished" : "failed";
}

/** How long after a run's end the island, mounting late, still announces it. */
const LATE_MOUNT_MS = 30_000;

/**
 * Whether a run ended just now, in the gap before the island was listening. The sheets island wakes
 * after the first status answer can arrive, and the event that answer sent reached nobody; looking
 * once at mount makes up for it. A run that ended before the page opened has its card and is not
 * announced again.
 */
export function endedRecently(run: RunRecord | null, now = Date.now()): boolean {
  return (
    run?.stageAt !== undefined &&
    (run.phase === "done" || run.phase === "failed") &&
    now - run.stageAt >= 0 &&
    now - run.stageAt < LATE_MOUNT_MS
  );
}
