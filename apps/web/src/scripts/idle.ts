/**
 * Runs `work` once the browser is idle (or after `timeout` ms at the latest). Code a press needs is
 * fetched this way, never on the press itself, so a first press does not wait on a download (D47).
 */
export function whenIdle(work: () => void, timeout = 4_000): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(work, { timeout });
  else setTimeout(work, 1_500);
}
