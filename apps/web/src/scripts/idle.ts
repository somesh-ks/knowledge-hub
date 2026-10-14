/**
 * Runs `work` once the browser is idle (or after `timeout` ms at the latest). Code a press needs is
 * fetched this way, never on the press itself, so a first press does not wait on a download (D47).
 */
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
    if (navigator.onLine) void load().catch(() => undefined);
  });
}
