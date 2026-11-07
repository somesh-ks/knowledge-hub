/**
 * Runs `work` once the browser is idle (or after `timeout` ms at the latest). Code a press needs is
 * fetched this way, never on the press itself, so a first press does not wait on a download (D47).
 */

let online: () => boolean = () => typeof navigator === "undefined" || navigator.onLine !== false;

/**
 * Tells warmWhenIdle which connection state to believe. The app sets its confirmed state
 * (lib/connectivity.ts, D330) once, from scripts/app.ts; the system does not import app code, and
 * until it is set the browser's own flag stands in.
 */
export function setOnlineProbe(probe: () => boolean): void {
  online = probe;
}

export function whenIdle(work: () => void, timeout = 4_000): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(work, { timeout });
  else setTimeout(work, 1_500);
}

/**
 * Fetches a module a press will need once the browser is idle, while online. Offline it is left to
 * the press: Chromium remembers a failed import and fails every later one, so a fetch that failed
 * here would fail the press as well (docs/learnings.md).
 */
export function warmWhenIdle(load: () => Promise<unknown>): void {
  whenIdle(() => {
    if (online()) void load().catch(() => undefined);
  });
}
