/**
 * The cancel tokens of the runs this browser started (D242). /api/generate and /api/podcast return
 * one with each run, and /api/cancel stops a run only with its token, so the queue offers Cancel only
 * on a run whose token is here: not on another device's, nor on the schedule's. A device-local record
 * in localStorage, shared by this browser's tabs, kept to the latest few runs.
 */
const KEY = "singularity:cancel-tokens";
const KEEP = 20;

function read(storage: Storage): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function rememberCancelToken(
  runId: number,
  token: unknown,
  storage: Storage = localStorage,
): void {
  if (typeof token !== "string" || !token) return;
  try {
    const kept = Object.entries(read(storage)).filter(([id]) => id !== String(runId));
    storage.setItem(
      KEY,
      JSON.stringify(Object.fromEntries([...kept, [String(runId), token]].slice(-KEEP))),
    );
  } catch {
    // Storage is full or off: the run still runs, it just cannot be stopped from here.
  }
}

export function cancelTokenOf(runId: number, storage: Storage = localStorage): string | null {
  try {
    return read(storage)[String(runId)] ?? null;
  } catch {
    return null;
  }
}
