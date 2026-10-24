/**
 * When a page may ask for its first segments in the background. Plain checks, so the narration
 * runtime can decide before it asks anything.
 */
const KEY_PREFIX = "singularity:prewarm:";

interface Connection {
  saveData?: boolean;
}

/** True when this tab has not yet tried this page, and marks it tried. Storage that fails says no. */
export function claimPrewarm(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  id: string,
): boolean {
  try {
    if (!storage || storage.getItem(KEY_PREFIX + id) !== null) return false;
    storage.setItem(KEY_PREFIX + id, "1");
    return true;
  } catch {
    return false;
  }
}

/** The conditions under which a background request is not welcome. */
export function prewarmAllowed(env: {
  hidden: boolean;
  saveData: boolean;
  online: boolean;
}): boolean {
  return !env.hidden && !env.saveData && env.online;
}

/**
 * A page with a briefing or an episode on it and no audio for it yet. A page without one (the
 * Library, Settings) has nothing to prewarm, and must not load the narration code for nothing.
 */
export function pageNeedsPrewarm(page: { audio: unknown } | null, online: boolean): boolean {
  return online && page !== null && !page.audio;
}

interface IdleScope {
  requestIdleCallback?: (work: () => void, options?: { timeout: number }) => unknown;
  setTimeout: (work: () => void, ms: number) => unknown;
}

/** The longest a prewarm waits for an idle moment on a busy page. */
const IDLE_TIMEOUT_MS = 3_000;

/** Runs `work` the next time the browser is idle, so it never competes with the first load. */
export function whenIdle(work: () => void, scope: IdleScope = globalThis as IdleScope): void {
  if (typeof scope.requestIdleCallback === "function") {
    scope.requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
  } else {
    // Safari has no idle callback: the next turn after the page's own work.
    scope.setTimeout(work, 0);
  }
}

/** Checks the browser and marks the page tried. True when the prewarm may go ahead. */
export function startPrewarm(id: string): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  const allowed = prewarmAllowed({
    hidden: document.hidden,
    saveData: connection?.saveData === true,
    online: navigator.onLine,
  });
  if (!allowed) return false;
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return claimPrewarm(storage, id);
}
